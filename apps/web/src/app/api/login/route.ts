import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, users } from '@/db'
import { overitHeslo } from '@/lib/heslo'
import {
  LOGIN_MAX_ATTEMPTS,
  authMode,
  clearLoginAttempts,
  recordLoginAttempt,
} from '@/lib/session'
import { zalozitRelaci, zapsatAudit } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const loginSchema = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
})

/** Zdržení po chybném hesle: zpomalí zkoušení a uživatelka si ho nevšimne. */
const WRONG_PASSWORD_DELAY_MS = 400

/** Po kolika chybných pokusech se účet sám na chvíli zavře. */
const ZAMEK_PO_POKUSECH = 10
const ZAMEK_MINUT = 15

export async function POST(request: Request) {
  if (authMode() === 'chybne-nastaveno') {
    return Response.json({ error: 'Přihlašování není nastavené — chybí AUTH_SECRET.' }, { status: 503 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'neznámá-adresa'

  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Vyplňte e-mail i heslo.' }, { status: 400 })
  }
  const email = parsed.data.email.trim().toLowerCase()

  // Klíčem je dvojice účtu a adresy: ve sborovně chodí všichni z jedné IP
  // a samotná adresa by je zamykala navzájem.
  const attempt = recordLoginAttempt(`${email}|${ip}`)
  if (!attempt.allowed) {
    return Response.json(
      {
        error: `Příliš mnoho pokusů o přihlášení. Zkuste to znovu za ${Math.ceil(attempt.retryAfterSeconds / 60)} min.`,
      },
      { status: 429, headers: { 'retry-after': String(attempt.retryAfterSeconds) } },
    )
  }

  const [ucet] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  const ted = Date.now()
  if (ucet?.lockedUntil && Date.parse(ucet.lockedUntil) > ted) {
    const minut = Math.max(1, Math.ceil((Date.parse(ucet.lockedUntil) - ted) / 60000))
    await zapsatAudit({
      schoolId: ucet.schoolId,
      userId: ucet.id,
      action: 'prihlaseni-zamceno',
      severity: 'chyba',
      ip,
    })
    return Response.json(
      { error: `Účet je po chybných pokusech dočasně zamčený. Zkuste to za ${minut} min.` },
      { status: 429 },
    )
  }

  const heslo = await overitHeslo(parsed.data.password, ucet?.passwordHash ?? null)
  if (!ucet || !heslo) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS))
    if (ucet) await zapsatNeuspech(ucet.id, ucet.schoolId, ucet.failedLogins, ip)
    return Response.json(
      {
        error:
          attempt.remaining <= 3
            ? `E-mail nebo heslo nesouhlasí. Zbývající pokusy: ${attempt.remaining} z ${LOGIN_MAX_ATTEMPTS}.`
            : 'E-mail nebo heslo nesouhlasí.',
      },
      { status: 401 },
    )
  }

  if (ucet.status !== 'aktivni') {
    await zapsatAudit({
      schoolId: ucet.schoolId,
      userId: ucet.id,
      action: 'prihlaseni-neaktivni-ucet',
      detail: { status: ucet.status },
      severity: 'chyba',
      ip,
    })
    return Response.json(
      {
        error:
          ucet.status === 'ceka'
            ? 'Účet zatím nemá přidělenou roli. Požádejte správce o schválení.'
            : 'Účet je zablokovaný. Obraťte se na správce.',
      },
      { status: 403 },
    )
  }

  clearLoginAttempts(`${email}|${ip}`)

  const cookie = await zalozitRelaci(ucet.id, { ip, userAgent: request.headers.get('user-agent') })
  await zapsatAudit({ schoolId: ucet.schoolId, userId: ucet.id, action: 'prihlaseni', ip })

  const response = Response.json({
    ok: true,
    mustChangePassword: ucet.mustChangePassword,
  })
  response.headers.append('set-cookie', cookie)
  return response
}

/**
 * Trvalé počítadlo u účtu. Počítadlo v paměti procesu je jen první brzda —
 * na serverless má každá instance funkce vlastní paměť, takže by se dalo
 * obejít prostým čekáním na jinou instanci.
 */
async function zapsatNeuspech(
  userId: string,
  schoolId: string,
  dosavadni: number,
  ip: string,
): Promise<void> {
  const pocet = dosavadni + 1
  const zamek =
    pocet >= ZAMEK_PO_POKUSECH ? new Date(Date.now() + ZAMEK_MINUT * 60_000).toISOString() : null
  await db
    .update(users)
    .set({ failedLogins: pocet, lockedUntil: zamek })
    .where(and(eq(users.id, userId)))
  await zapsatAudit({
    schoolId,
    userId,
    action: 'prihlaseni-chybne-heslo',
    detail: { pocet },
    severity: 'chyba',
    ip,
  })
}
