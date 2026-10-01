import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { t } from '@testmaker/core/i18n'

/**
 * Google account sign-in, by hand and without a library.
 *
 * It is a plain OAuth 2.0 "authorization code" flow with PKCE: the app sends
 * the teacher to Google, which returns her with a code, and the server
 * exchanges the code for tokens. A library like NextAuth would bring its own
 * session model, which we already have, and its own tables, which we don't want.
 */

export interface GoogleSettings {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Domain of school accounts; without it there is no Google sign-in. */
  hd: string | null
}

/** Settings from the environment; `null` means "Google is not offered". */
export function googleSettings(
  env: Record<string, string | undefined> = process.env,
): GoogleSettings | null {
  const clientId = env.GOOGLE_CLIENT_ID
  const clientSecret = env.GOOGLE_CLIENT_SECRET
  const redirectUri = env.GOOGLE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri, hd: env.GOOGLE_HD ?? null }
}

export const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

export interface OauthState {
  state: string
  codeVerifier: string
  /** Where the user should return after sign-in. */
  dal: string
}

export function newOauthState(next: string): OauthState {
  return { state: base64url(randomBytes(24)), codeVerifier: base64url(randomBytes(32)), dal: next }
}

export function codeChallenge(codeVerifier: string): string {
  return base64url(createHash('sha256').update(codeVerifier).digest())
}

/** The address the user is sent to for sign-in. */
export function authorizationUrl(settings: GoogleSettings, state: OauthState): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', settings.clientId)
  url.searchParams.set('redirect_uri', settings.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state.state)
  url.searchParams.set('code_challenge', codeChallenge(state.codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  // The account is chosen every time: several people take turns at one staff-room computer.
  url.searchParams.set('prompt', 'select_account')
  if (settings.hd) url.searchParams.set('hd', settings.hd)
  return url.toString()
}

export interface GoogleIdentity {
  sub: string
  email: string
  name: string
  /** Account domain from Google Workspace. */
  hd: string | null
}

/**
 * Contents of `id_token` without signature verification.
 *
 * The token came straight from Google's token endpoint over TLS, so per OIDC
 * we need not verify the signature nor download JWKS keys. If `id_token` were
 * ever taken from the browser (Google One Tap), signature verification must
 * be added — otherwise making up a token would suffice.
 */
export function decodeIdToken(idToken: string): Record<string, unknown> | null {
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

const ISS = new Set(['accounts.google.com', 'https://accounts.google.com'])

/** Checks the token claims and extracts the identity, or a user-facing message. */
export function verifyIdToken(
  idToken: string,
  settings: GoogleSettings,
  now: number = Date.now(),
): { identity: GoogleIdentity } | { error: string } {
  const claims = decodeIdToken(idToken)
  if (!claims) return { error: t('auth:google.unreadableResponse') }

  const iss = typeof claims.iss === 'string' ? claims.iss : ''
  const aud = typeof claims.aud === 'string' ? claims.aud : ''
  const exp = typeof claims.exp === 'number' ? claims.exp : 0
  if (!ISS.has(iss) || aud !== settings.clientId || exp * 1000 <= now) {
    return { error: t('auth:google.verifyFailed') }
  }

  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : ''
  if (!email || claims.email_verified !== true) {
    return { error: t('auth:google.emailNotVerified') }
  }

  const hd = typeof claims.hd === 'string' ? claims.hd : null
  if (settings.hd && hd !== settings.hd) {
    return {
      error: t('auth:google.wrongDomain', { domain: settings.hd }),
    }
  }

  const sub = typeof claims.sub === 'string' ? claims.sub : ''
  if (!sub) return { error: t('auth:google.missingSub') }

  const name = typeof claims.name === 'string' && claims.name ? claims.name : email
  return { identity: { sub, email, name, hd } }
}

/** Exchanges the code for tokens. Returns `id_token`, we need nothing else. */
export async function exchangeCode(
  settings: GoogleSettings,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ idToken: string } | { error: string }> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: settings.redirectUri,
    }),
  })
  if (!response.ok) {
    return { error: t('auth:google.rejected') }
  }
  const data = (await response.json()) as { id_token?: string }
  if (!data.id_token) return { error: t('auth:google.missingToken') }
  return { idToken: data.id_token }
}

/**
 * A redirect that still accepts cookies. `Response.redirect()` returns a
 * response with locked headers, so a session cannot be attached to it.
 */
export function redirectResponse(target: string | URL, cookies: string[] = []): Response {
  const headers = new Headers({ location: String(target) })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 307, headers })
}

export { safeReturnPath } from './returnPath'
