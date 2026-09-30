import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import { auditLog, db, schools, sessions, users } from '@/db'
import { newId } from '@/lib/ids'
import { roleJeAdministrator, roleMuzeMenit, roleMuzeSpravovat, type Role } from '@/lib/role'
import { VYCHOZI_UCET_ID } from '@/lib/vychozi'
import {
  RELACE_MAX_MS,
  RELACE_TTL_MS,
  SESSION_COOKIE,
  authMode,
  overitRelaci,
  podepsatRelaci,
  relaceCookie,
} from '@/lib/session'

/**
 * Kdo právě pracuje a v jaké škole. Tohle je jediný vstupní bod k identitě —
 * funkce v `lib/*` dostávají `Scope` jako první parametr, aby je nešlo zavolat
 * bez rozsahu a překladač na to upozornil.
 *
 * Podpis cookie ověřuje `proxy.ts` bez databáze; tady se teprve dotáhne řádek
 * relace a účtu, takže se pozná odvolaná relace i zablokovaný účet.
 */
export interface Scope {
  readonly schoolId: string
  readonly userId: string
  readonly role: Role
}

export interface Prihlaseny extends Scope {
  jmeno: string
  email: string
  /** Název školy, ve které se právě pracuje (u administrátora té vybrané). */
  skola: string
  /**
   * Škola, ke které účet patří. U administrátora se může lišit od `schoolId`,
   * když se přepnul jinam; u ostatních rolí je vždycky stejná.
   */
  domovskaSkolaId: string
  sid: string
  mustChangePassword: boolean
}

export { VYCHOZI_UCET_ID } from './vychozi'

export class NeniPrihlasen extends Error {
  constructor() {
    super('Nepřihlášeno')
    this.name = 'NeniPrihlasen'
  }
}

export class NemaOpravneni extends Error {
  constructor(message = 'Na tuhle akci nemáte oprávnění.') {
    super(message)
    this.name = 'NemaOpravneni'
  }
}

/**
 * Přihlášená osoba pro tenhle požadavek. `cache()` z Reactu zajistí, že se
 * dvojice dotazů udělá jednou, i když si o uživatele řekne stránka i každá
 * serverová funkce pod ní.
 */
export const aktualniUzivatel = cache(async (): Promise<Prihlaseny | null> => {
  if (authMode() === 'vypnuto') return vychoziUzivatel()

  const cookieStore = await cookies()
  const relace = await overitRelaci(
    cookieStore.get(SESSION_COOKIE)?.value,
    process.env.AUTH_SECRET ?? '',
  )
  if (!relace) return null

  const [row] = await db
    .select({
      userId: users.id,
      schoolId: users.schoolId,
      role: users.role,
      jmeno: users.name,
      email: users.email,
      skola: schools.name,
      sessionVersion: users.sessionVersion,
      mustChangePassword: users.mustChangePassword,
      status: users.status,
      activeSchoolId: users.activeSchoolId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(schools, eq(schools.id, users.schoolId))
    .where(
      and(
        eq(sessions.id, relace.sid),
        eq(sessions.userId, relace.uid),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1)

  if (!row || row.status !== 'aktivni' || row.sessionVersion !== relace.sv) return null

  // Relace se používá, takže jde vidět, že je zařízení živé; podle toho se
  // ve správě pozná, co je opuštěná přihláška.
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(sessions.id, relace.sid))

  const vybrana = await vybranaSkola(row)
  return {
    schoolId: vybrana?.id ?? row.schoolId,
    userId: row.userId,
    role: row.role,
    jmeno: row.jmeno,
    email: row.email,
    skola: vybrana?.name ?? row.skola,
    domovskaSkolaId: row.schoolId,
    sid: relace.sid,
    mustChangePassword: row.mustChangePassword,
  }
})

/**
 * Škola, do které se administrátor přepnul. `null` znamená pracovat
 * v domovské — u jiné role vždycky, u administrátora bez výběru, a taky když
 * vybraná škola mezitím zmizela (cizí klíč ji nuluje, ale jistota je jistota).
 */
async function vybranaSkola(row: {
  role: Role
  schoolId: string
  activeSchoolId: string | null
}): Promise<{ id: string; name: string } | null> {
  if (!roleJeAdministrator(row.role) || !row.activeSchoolId || row.activeSchoolId === row.schoolId) {
    return null
  }
  const [skola] = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .where(eq(schools.id, row.activeSchoolId))
    .limit(1)
  return skola ?? null
}

/**
 * Bez přihlašování (lokální `next dev`, testy v prohlížeči) se pracuje pod
 * pevným účtem. Musí existovat doopravdy — cizí klíče u testů, hlavolamů
 * i fronty by jinak neměly na co ukazovat. Zakládá ho `db/seed.ts`
 * i `scripts/seed-e2e.ts`.
 *
 * `E2E_UZIVATEL` umí identitu přepnout; platí to jedině v tomhle režimu,
 * takže se tím v nasazení nedá nic obejít.
 */
async function vychoziUzivatel(): Promise<Prihlaseny | null> {
  const id = process.env.E2E_UZIVATEL || VYCHOZI_UCET_ID
  const vyber = {
    userId: users.id,
    schoolId: users.schoolId,
    role: users.role,
    jmeno: users.name,
    email: users.email,
    skola: schools.name,
    activeSchoolId: users.activeSchoolId,
  }

  const [pevny] = await db
    .select(vyber)
    .from(users)
    .innerJoin(schools, eq(schools.id, users.schoolId))
    .where(eq(users.id, id))
    .limit(1)
  if (pevny) return bezPrihlaseni(pevny)

  /*
   * Databáze ze seedu má účet s pevným id; ta, která vznikla migrací z verze
   * pro jednu učitelku, ne. Aby se aplikace lokálně otevřela i nad ní, vezme
   * se první správce — jinak by vývoj nad ostrými daty skončil chybou
   * „no such user“, která s ničím nepomůže.
   */
  const [prvniSpravce] = await db
    .select(vyber)
    .from(users)
    .innerJoin(schools, eq(schools.id, users.schoolId))
    .where(eq(users.role, 'spravce'))
    .orderBy(asc(users.createdAt))
    .limit(1)
  if (!prvniSpravce) return null
  return bezPrihlaseni(prvniSpravce)
}

async function bezPrihlaseni(row: {
  userId: string
  schoolId: string
  role: Role
  jmeno: string
  email: string
  skola: string
  activeSchoolId: string | null
}): Promise<Prihlaseny> {
  const vybrana = await vybranaSkola(row)
  return {
    userId: row.userId,
    role: row.role,
    jmeno: row.jmeno,
    email: row.email,
    schoolId: vybrana?.id ?? row.schoolId,
    skola: vybrana?.name ?? row.skola,
    domovskaSkolaId: row.schoolId,
    sid: 'bez-prihlaseni',
    mustChangePassword: false,
  }
}

/** Přihlášená osoba, nebo výjimka, kterou route handler přeloží na 401. */
export async function requireScope(): Promise<Prihlaseny> {
  const uzivatel = await aktualniUzivatel()
  if (!uzivatel) throw new NeniPrihlasen()
  return uzivatel
}

/**
 * Přihlášená osoba pro serverovou stránku. Když relace neplatí, stránka se
 * nevykreslí a prohlížeč jde na přihlášení — házet výjimku by uživatelce
 * ukázalo chybovou obrazovku Next.js místo formuláře.
 */
export async function ucetStranky(): Promise<Prihlaseny> {
  const uzivatel = await aktualniUzivatel()
  if (!uzivatel) redirect('/login')
  return uzivatel
}

/** Přihlášená osoba s jednou z uvedených rolí, jinak výjimka na 403. */
export async function requireRole(...role: Role[]): Promise<Prihlaseny> {
  const uzivatel = await requireScope()
  if (!role.includes(uzivatel.role)) throw new NemaOpravneni()
  return uzivatel
}

/** Přihlášená osoba, která smí měnit obsah (tedy kdokoli kromě náhledu). */
export async function requireZapis(): Promise<Prihlaseny> {
  const uzivatel = await requireScope()
  if (!roleMuzeMenit(uzivatel.role)) {
    throw new NemaOpravneni('Máte přístup jen pro čtení, měnit obsah nemůžete.')
  }
  return uzivatel
}

export function muzeMenitObsah(scope: Scope): boolean {
  return roleMuzeMenit(scope.role)
}

export function muzeSpravovat(scope: Scope): boolean {
  return roleMuzeSpravovat(scope.role)
}

/** Rozsah pro běh z fronty: sezení tam žádné není, bere se z úlohy. */
export function scopeFromJob(job: { schoolId: string; requestedBy: string }): Scope {
  return { schoolId: job.schoolId, userId: job.requestedBy, role: 'ucitelka' }
}

/** Založí relaci a vrátí hodnotu hlavičky `Set-Cookie`. */
export async function zalozitRelaci(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<string> {
  const [ucet] = await db
    .select({
      schoolId: users.schoolId,
      role: users.role,
      sessionVersion: users.sessionVersion,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!ucet) throw new Error('Účet neexistuje')

  const sid = newId()
  const now = Date.now()
  await db.insert(sessions).values({
    id: sid,
    userId,
    expiresAt: new Date(now + RELACE_MAX_MS).toISOString(),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  await db
    .update(users)
    .set({ lastLoginAt: new Date(now).toISOString(), failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, userId))

  const token = await podepsatRelaci(
    {
      uid: userId,
      sch: ucet.schoolId,
      sid,
      role: ucet.role,
      sv: ucet.sessionVersion,
      exp: now + RELACE_TTL_MS,
      ...(ucet.mustChangePassword ? { zh: true } : {}),
    },
    process.env.AUTH_SECRET ?? '',
  )
  return relaceCookie(token)
}

export async function ukoncitRelaci(sid: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, sid), isNull(sessions.revokedAt)))
}

/** Odhlásí účet ze všech zařízení naráz. */
export { odvolatVsechnyRelaceBezRelace as odvolatVsechnyRelace } from './uctyServis'

export interface AuditZaznam {
  schoolId?: string | null
  userId?: string | null
  action: string
  entity?: string | null
  entityId?: string | null
  detail?: unknown
  severity?: 'info' | 'chyba'
  ip?: string | null
}

/**
 * Zápis do záznamu událostí. Nikdy nesmí shodit akci, kterou popisuje —
 * proto se případná chyba jen zaloguje.
 */
export async function zapsatAudit(zaznam: AuditZaznam): Promise<void> {
  try {
    const detail = await sPriznakemAdministratora(zaznam)
    await db.insert(auditLog).values({
      id: newId(),
      schoolId: zaznam.schoolId ?? null,
      userId: zaznam.userId ?? null,
      action: zaznam.action,
      entity: zaznam.entity ?? null,
      entityId: zaznam.entityId ?? null,
      detail,
      severity: zaznam.severity ?? 'info',
      ip: zaznam.ip ?? null,
    })
  } catch (error) {
    console.error('Událost se nepodařilo zapsat:', error)
  }
}

/**
 * Když událost zapisuje administrátor mimo svou domovskou školu, dostane
 * příznak — správce té školy pak v záznamu vidí, že na věc sáhl někdo zvenku.
 * Pozná se to z účtu, ne od volajícího, aby na to žádné místo nezapomnělo.
 */
async function sPriznakemAdministratora(zaznam: AuditZaznam): Promise<unknown> {
  const detail = zaznam.detail ?? null
  if (!zaznam.userId || !zaznam.schoolId) return detail
  const [autor] = await db
    .select({ role: users.role, schoolId: users.schoolId })
    .from(users)
    .where(eq(users.id, zaznam.userId))
    .limit(1)
  if (!autor || !roleJeAdministrator(autor.role) || autor.schoolId === zaznam.schoolId) return detail
  const zaklad = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : detail === null ? {} : { hodnota: detail }
  return { ...zaklad, administrator: true }
}

/** Adresa volajícího z hlaviček za Vercelem; pro počítadlo pokusů a záznam. */
export async function adresaVolajiciho(): Promise<string | null> {
  const hlavicky = await headers()
  return hlavicky.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

/**
 * Obal pro route handlery: zjistí přihlášenou osobu, ověří roli a případné
 * odmítnutí přeloží na odpověď s českou hláškou. Bez něj by každý handler
 * začínal stejnými pěti řádky try/catch a někde by se na ně zapomnělo.
 */
export async function sRozsahem(
  handler: (ucet: Prihlaseny) => Promise<Response> | Response,
  options: { role?: Role[]; zapis?: boolean } = {},
): Promise<Response> {
  try {
    const ucet = options.role
      ? await requireRole(...options.role)
      : options.zapis
        ? await requireZapis()
        : await requireScope()
    return await handler(ucet)
  } catch (error) {
    const odpoved = odpovedNaChybuPristupu(error)
    if (odpoved) return odpoved
    throw error
  }
}

/** Odpověď na výjimky z `requireScope`/`requireRole` v route handlerech. */
export function odpovedNaChybuPristupu(error: unknown): Response | null {
  if (error instanceof NeniPrihlasen) {
    return Response.json({ error: 'Nepřihlášeno' }, { status: 401 })
  }
  if (error instanceof NemaOpravneni) {
    return Response.json({ error: error.message }, { status: 403 })
  }
  return null
}

/** Podmínka „patří do mé školy“ pro dotazy nad tabulkou se sloupcem `school_id`. */
export function skola(scope: Scope, tabulka: { schoolId: AnyColumn }) {
  return eq(tabulka.schoolId, scope.schoolId)
}

/**
 * Podmínka „je to moje“ — škola a zároveň vlastník. Administrátor má ve
 * vybrané škole plná práva, takže u něj platí jen podmínka na školu.
 */
export function vlastni(scope: Scope, tabulka: { schoolId: AnyColumn; ownerId: AnyColumn }) {
  if (roleJeAdministrator(scope.role)) return eq(tabulka.schoolId, scope.schoolId)
  return and(eq(tabulka.schoolId, scope.schoolId), eq(tabulka.ownerId, scope.userId))
}

/**
 * Písemka, na kterou je vidět: vlastní, nebo nasdílená kolegyním. Správce
 * cizí písemky nedostává — má je jen v záloze celé školy. Administrátor vidí
 * ve vybrané škole všechny.
 */
export function viditelnyTest(
  scope: Scope,
  tabulka: { schoolId: AnyColumn; ownerId: AnyColumn; visibility: AnyColumn },
) {
  if (roleJeAdministrator(scope.role)) return eq(tabulka.schoolId, scope.schoolId)
  return and(
    eq(tabulka.schoolId, scope.schoolId),
    or(eq(tabulka.ownerId, scope.userId), eq(tabulka.visibility, 'skola')),
  )
}

type AnyColumn = Parameters<typeof eq>[0]
