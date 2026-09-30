import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schools, users } from '@/db'
import { vygenerovatHeslo, zahesovat, zkontrolovatSilu } from '@/lib/heslo'
import { newId } from '@/lib/ids'
import { ROLE_SPRAVY, ROLES, ROLES_PRIDELITELNE, roleJeAdministrator, type Role } from '@/lib/role'
import { odvolatVsechnyRelace, sRozsahem, zapsatAudit } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const roleSchema = z.enum(ROLES as unknown as [Role, ...Role[]])

/**
 * Administrátora přiděluje jen skript u databáze: uniklý účet správce se tak
 * přes aplikaci na administrátora nepovýší. Schéma roli zná (jinak by se
 * nedala vrátit srozumitelná hláška), odmítá se až tady.
 */
const NEPRIDELITELNA = 'Tuhle roli v aplikaci přidělit nejde.'
const ADMIN_JEN_SKRIPTEM = 'Administrátorský účet se mění jen skriptem.'

function pridelitelna(role: Role | undefined): boolean {
  return role === undefined || ROLES_PRIDELITELNE.includes(role)
}

const createSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(200),
  role: roleSchema.default('ucitelka'),
})

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  role: roleSchema.optional(),
  status: z.enum(['aktivni', 'ceka', 'zablokovany']).optional(),
  /** `heslo` vygeneruje nové a vrátí ho jednorázově v odpovědi. */
  heslo: z.literal(true).optional(),
  /** Odhlásí účet ze všech zařízení. */
  odhlasit: z.literal(true).optional(),
})

/** Seznam účtů školy — jádro správcovské obrazovky. */
export async function GET() {
  return sRozsahem(
    async (ucet) => {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          status: users.status,
          maHeslo: users.passwordHash,
          maGoogle: users.googleSub,
          mustChangePassword: users.mustChangePassword,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.schoolId, ucet.schoolId))
        .orderBy(asc(users.name))

      const [skola] = await db
        .select({ name: schools.name, googleDomain: schools.googleDomain })
        .from(schools)
        .where(eq(schools.id, ucet.schoolId))
        .limit(1)

      return Response.json({
        skola,
        uzivatele: rows.map((row) => ({
          ...row,
          // Hash ven nikdy nejde; stačí, že je vidět, jestli heslo vůbec má.
          maHeslo: Boolean(row.maHeslo),
          maGoogle: Boolean(row.maGoogle),
        })),
      })
    },
    { role: ROLE_SPRAVY },
  )
}

/** Založí účet. Heslo se vygeneruje a vypíše jednou — správce ho předá osobně. */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const parsed = createSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
      if (!pridelitelna(parsed.data.role)) {
        return Response.json({ error: NEPRIDELITELNA }, { status: 400 })
      }

      const email = parsed.data.email.trim().toLowerCase()
      const [existujici] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      if (existujici) {
        return Response.json({ error: `Účet ${email} už existuje.` }, { status: 409 })
      }

      const heslo = vygenerovatHeslo()
      const id = newId()
      await db.insert(users).values({
        id,
        schoolId: ucet.schoolId,
        email,
        name: parsed.data.name.trim(),
        role: parsed.data.role,
        passwordHash: await zahesovat(heslo),
        // První přihlášení skončí u změny hesla: to, co správce nadiktoval,
        // zná zbytečně někdo druhý.
        mustChangePassword: true,
        createdBy: ucet.userId,
      })
      await zapsatAudit({
        schoolId: ucet.schoolId,
        userId: ucet.userId,
        action: 'ucet-zalozen',
        entity: 'user',
        entityId: id,
        detail: { email, role: parsed.data.role },
      })

      return Response.json({ id, heslo })
    },
    { role: ROLE_SPRAVY },
  )
}

/** Úprava účtu: jméno, role, stav, reset hesla, odhlášení ze všech zařízení. */
export async function PATCH(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const parsed = updateSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
      if (!pridelitelna(parsed.data.role)) {
        return Response.json({ error: NEPRIDELITELNA }, { status: 400 })
      }

      const [cil] = await db.select().from(users).where(eq(users.id, parsed.data.id)).limit(1)
      if (!cil || cil.schoolId !== ucet.schoolId) {
        return Response.json({ error: 'Účet se nenašel' }, { status: 404 })
      }
      if (roleJeAdministrator(cil.role)) {
        return Response.json({ error: ADMIN_JEN_SKRIPTEM }, { status: 403 })
      }

      // Poslední správce nesmí zmizet — jinak by se do správy nedostal nikdo
      // a účty by šlo měnit jedině skriptem u databáze.
      const rusiSpravce =
        cil.role === 'spravce' &&
        ((parsed.data.role && parsed.data.role !== 'spravce') ||
          (parsed.data.status && parsed.data.status !== 'aktivni'))
      if (rusiSpravce) {
        const spravci = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.schoolId, ucet.schoolId),
              eq(users.role, 'spravce'),
              eq(users.status, 'aktivni'),
            ),
          )
        if (spravci.length <= 1) {
          return Response.json(
            { error: 'Tohle je poslední správce školy. Nejdřív udělej správcem někoho dalšího.' },
            { status: 409 },
          )
        }
      }

      const zmeny: Record<string, unknown> = {}
      if (parsed.data.name) zmeny.name = parsed.data.name.trim()
      if (parsed.data.role) zmeny.role = parsed.data.role
      if (parsed.data.status) zmeny.status = parsed.data.status

      let heslo: string | null = null
      if (parsed.data.heslo) {
        heslo = vygenerovatHeslo()
        const problem = zkontrolovatSilu(heslo)
        if (problem) return Response.json({ error: problem }, { status: 500 })
        zmeny.passwordHash = await zahesovat(heslo)
        zmeny.mustChangePassword = true
        zmeny.failedLogins = 0
        zmeny.lockedUntil = null
      }

      if (Object.keys(zmeny).length > 0) {
        await db.update(users).set(zmeny).where(eq(users.id, cil.id))
      }
      // Reset hesla, zablokování i výslovné odhlášení musí shodit otevřená okna.
      // Změna role taky: role je zapsaná v cookie a brána by se až do nového
      // přihlášení řídila tou starou.
      const zmenaRole = parsed.data.role !== undefined && parsed.data.role !== cil.role
      if (heslo || parsed.data.odhlasit || parsed.data.status === 'zablokovany' || zmenaRole) {
        await odvolatVsechnyRelace(cil.id)
      }

      await zapsatAudit({
        schoolId: ucet.schoolId,
        userId: ucet.userId,
        action: 'ucet-upraven',
        entity: 'user',
        entityId: cil.id,
        detail: { ...parsed.data, heslo: undefined },
      })

      return Response.json({ ok: true, ...(heslo ? { heslo } : {}) })
    },
    { role: ROLE_SPRAVY },
  )
}

/**
 * Odebrání přístupu. Účet se nemaže — visí na něm autorství otázek i písemek
 * a záznam událostí; místo toho se zablokuje a odhlásí.
 */
export async function DELETE(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return Response.json({ error: 'Chybí id' }, { status: 400 })
      if (id === ucet.userId) {
        return Response.json({ error: 'Sebe zablokovat nemůžeš.' }, { status: 409 })
      }

      const [cil] = await db.select().from(users).where(eq(users.id, id)).limit(1)
      if (!cil || cil.schoolId !== ucet.schoolId) {
        return Response.json({ error: 'Účet se nenašel' }, { status: 404 })
      }
      if (roleJeAdministrator(cil.role)) {
        return Response.json({ error: ADMIN_JEN_SKRIPTEM }, { status: 403 })
      }

      await db.update(users).set({ status: 'zablokovany' }).where(eq(users.id, id))
      await odvolatVsechnyRelace(id)
      await zapsatAudit({
        schoolId: ucet.schoolId,
        userId: ucet.userId,
        action: 'ucet-zablokovan',
        entity: 'user',
        entityId: id,
        detail: { email: cil.email },
      })
      return Response.json({ ok: true })
    },
    { role: ROLE_SPRAVY },
  )
}
