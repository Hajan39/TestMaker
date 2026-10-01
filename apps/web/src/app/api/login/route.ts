import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { t } from '@testmaker/core/i18n'
import { db, users } from '@/db'
import { verifyPassword } from '@/lib/password'
import {
  LOGIN_MAX_ATTEMPTS,
  authMode,
  clearLoginAttempts,
  recordLoginAttempt,
} from '@/lib/session'
import { createSession, writeAudit } from '@/lib/user'

export const runtime = 'nodejs'

const loginSchema = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
})

/** Delay after a wrong password: slows guessing and the user won't notice it. */
const WRONG_PASSWORD_DELAY_MS = 400

/** After how many failed attempts the account locks itself for a while. */
const LOCK_AFTER_ATTEMPTS = 10
const LOCK_MINUTES = 15

export async function POST(request: Request) {
  if (authMode() === 'chybne-nastaveno') {
    return Response.json({ error: t('auth:login.missingSecret') }, { status: 503 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'neznámá-adresa'

  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: t('auth:login.fillBoth') }, { status: 400 })
  }
  const email = parsed.data.email.trim().toLowerCase()

  // The key is the account and address pair: everyone in the staff room comes
  // from one IP and the address alone would lock them out of each other.
  const attempt = recordLoginAttempt(`${email}|${ip}`)
  if (!attempt.allowed) {
    return Response.json(
      {
        error: t('auth:login.tooManyAttempts', { minutes: Math.ceil(attempt.retryAfterSeconds / 60) }),
      },
      { status: 429, headers: { 'retry-after': String(attempt.retryAfterSeconds) } },
    )
  }

  const [account] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  const now = Date.now()
  if (account?.lockedUntil && Date.parse(account.lockedUntil) > now) {
    const minutes = Math.max(1, Math.ceil((Date.parse(account.lockedUntil) - now) / 60000))
    await writeAudit({
      schoolId: account.schoolId,
      userId: account.id,
      action: 'prihlaseni-zamceno',
      severity: 'chyba',
      ip,
    })
    return Response.json(
      { error: t('auth:login.locked', { minutes }) },
      { status: 429 },
    )
  }

  const password = await verifyPassword(parsed.data.password, account?.passwordHash ?? null)
  if (!account || !password) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS))
    if (account) await recordFailure(account.id, account.schoolId, account.failedLogins, ip)
    return Response.json(
      {
        error:
          attempt.remaining <= 3
            ? t('auth:login.wrongCredentialsRemaining', { remaining: attempt.remaining, max: LOGIN_MAX_ATTEMPTS })
            : t('auth:login.wrongCredentials'),
      },
      { status: 401 },
    )
  }

  if (account.status !== 'aktivni') {
    await writeAudit({
      schoolId: account.schoolId,
      userId: account.id,
      action: 'prihlaseni-neaktivni-ucet',
      detail: { status: account.status },
      severity: 'chyba',
      ip,
    })
    return Response.json(
      {
        error:
          account.status === 'ceka' ? t('auth:account.pending') : t('auth:account.blocked'),
      },
      { status: 403 },
    )
  }

  clearLoginAttempts(`${email}|${ip}`)

  const cookie = await createSession(account.id, { ip, userAgent: request.headers.get('user-agent') })
  await writeAudit({ schoolId: account.schoolId, userId: account.id, action: 'prihlaseni', ip })

  const response = Response.json({
    ok: true,
    mustChangePassword: account.mustChangePassword,
  })
  response.headers.append('set-cookie', cookie)
  return response
}

/**
 * Persistent counter on the account. The in-process counter is only a first
 * brake — on serverless each function instance has its own memory, so it
 * could be bypassed by simply waiting for another instance.
 */
async function recordFailure(
  userId: string,
  schoolId: string,
  previous: number,
  ip: string,
): Promise<void> {
  const count = previous + 1
  const lock =
    count >= LOCK_AFTER_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null
  await db
    .update(users)
    .set({ failedLogins: count, lockedUntil: lock })
    .where(and(eq(users.id, userId)))
  await writeAudit({
    schoolId,
    userId,
    action: 'prihlaseni-chybne-heslo',
    detail: { pocet: count },
    severity: 'chyba',
    ip,
  })
}
