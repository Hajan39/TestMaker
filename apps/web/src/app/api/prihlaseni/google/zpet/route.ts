import { and, eq } from 'drizzle-orm'
import { db, schools, users } from '@/db'
import { OAUTH_COOKIE } from '@/lib/session'
import {
  safeReturnPath,
  googleSettings,
  verifyIdToken,
  redirectResponse,
  exchangeCode,
  type OauthState,
} from '@/lib/google'
import { createSession, writeAudit } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

/** The state cookie is read once and dropped right away — against replaying the response. */
function readState(request: Request): OauthState | null {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((piece) => piece.trim())
    .find((piece) => piece.startsWith(`${OAUTH_COOKIE}=`))
  if (!cookie) return null
  try {
    const state = JSON.parse(decodeURIComponent(cookie.slice(OAUTH_COOKIE.length + 1))) as OauthState
    return state.state && state.codeVerifier ? state : null
  } catch {
    return null
  }
}

function clearState(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${OAUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

/** Back to sign-in with a message; `info` is shown neutrally, not red like an error. */
function backWithError(origin: string, error: string, kind: 'chyba' | 'info' = 'chyba'): Response {
  const login = new URL('/login', origin)
  login.searchParams.set(kind, error)
  return redirectResponse(login, [clearState()])
}

/**
 * Return from Google. The state is checked, the code exchanged for an
 * `id_token` and the identity taken from it. An account unknown to the app is,
 * depending on the school settings, either rejected or created as pending —
 * even then it does not get in by itself.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const settings = googleSettings()
  if (!settings) {
    return backWithError(url.origin, t('auth:google.notConfigured'))
  }

  const state = readState(request)
  const code = url.searchParams.get('code')
  if (!state || !code || url.searchParams.get('state') !== state.state) {
    return backWithError(url.origin, t('auth:google.expired'))
  }

  const swap = await exchangeCode(settings, code, state.codeVerifier)
  if ('error' in swap) return backWithError(url.origin, swap.error)

  const verification = verifyIdToken(swap.idToken, settings)
  if ('error' in verification) return backWithError(url.origin, verification.error)
  const { identity } = verification

  // The school is recognised by the account domain; without one sign-in is impossible.
  const [school] = identity.hd
    ? await db.select().from(schools).where(eq(schools.googleDomain, identity.hd)).limit(1)
    : []
  if (!school) {
    return backWithError(
      url.origin,
      identity.hd ? t('auth:google.unknownDomain', { domain: identity.hd }) : t('auth:google.noDomain'),
    )
  }

  // First by the permanent identifier, then by e-mail: an account created
  // with a password just gets linked to Google, no second one appears.
  const [bySub] = await db.select().from(users).where(eq(users.googleSub, identity.sub)).limit(1)
  const [byEmail] = bySub
    ? []
    : await db
        .select()
        .from(users)
        .where(and(eq(users.email, identity.email), eq(users.schoolId, school.id)))
        .limit(1)
  const account = bySub ?? byEmail

  if (!account) {
    if (!school.googleAutoJoin) {
      await writeAudit({
        schoolId: school.id,
        action: 'google-neznamy-ucet',
        detail: { email: identity.email },
        severity: 'chyba',
      })
      return backWithError(
        url.origin,
        t('auth:google.noAccess', { email: identity.email }),
      )
    }

    // A pending account has no role to work with — until a manager approves
    // it, it cannot sign in.
    await db.insert(users).values({
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      schoolId: school.id,
      email: identity.email,
      name: identity.name,
      role: 'nahled',
      googleSub: identity.sub,
      status: 'ceka',
    })
    await writeAudit({
      schoolId: school.id,
      action: 'google-cekajici-ucet',
      detail: { email: identity.email },
    })
    return backWithError(
      url.origin,
      t('auth:google.registered'),
      'info',
    )
  }

  if (account.status !== 'aktivni') {
    return backWithError(
      url.origin,
      account.status === 'ceka' ? t('auth:account.pending') : t('auth:account.blocked'),
    )
  }

  // Linking on the first Google sign-in to an account created with a password.
  if (!account.googleSub) {
    await db.update(users).set({ googleSub: identity.sub }).where(eq(users.id, account.id))
  }

  const cookie = await createSession(account.id, {
    ip: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
  })
  await writeAudit({
    schoolId: account.schoolId,
    userId: account.id,
    action: 'prihlaseni-google',
    ip: request.headers.get('x-forwarded-for'),
  })

  const target = new URL(account.mustChangePassword ? '/zmena-hesla' : safeReturnPath(state.dal), url.origin)
  return redirectResponse(target, [cookie, clearState()])
}
