/**
 * Session: a signed cookie plus a row in the `sessions` table.
 *
 * The cookie carries `base64url(JSON).hex(HMAC-SHA256)` — whoever knows
 * `AUTH_SECRET` can produce it, nobody else. Signature and expiry can be
 * checked without the database, which is required: this module is read by
 * `proxy.ts`, which runs in the Edge runtime. Hence not a single import from
 * `@/db` or `node:crypto` here — `test/proxy-module.test.ts` guards it.
 *
 * What the cookie alone cannot do is revocation: until it expires, it is
 * valid. Hence the row in `sessions` (signing out one device) and the
 * account's `sessionVersion` number (signing out everywhere). Both are
 * checked only on the server in `lib/user.ts`.
 */
import { isAdministratorRole, roleCanManage, type Role } from './role'

export type { Role } from './role'

export const SESSION_COOKIE = 'tm_relace'

/**
 * Cookie from the old single-password sign-in. New code does not read it,
 * only deletes it in responses so it does not linger in the browser.
 */
export const LEGACY_COOKIE = 'tm_session'

/** Cookie holding `state` and `code_verifier` during the Google redirect. */
export const OAUTH_COOKIE = 'tm_oauth'

/** Sliding cookie lifetime: a fresh one is issued after half of it. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

/** Absolute session lifetime regardless of how it is used. */
export const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000

export interface Session {
  v: 1
  /** User. */
  uid: string
  /** School — so the proxy need not hit the database to decide on a path. */
  sch: string
  /** Row in `sessions`; the session can be revoked through it. */
  sid: string
  role: Role
  /** `users.sessionVersion` at the time of issue. */
  sv: number
  /** Expiry in milliseconds. */
  exp: number
  /** After a password reset the account may only go to `/zmena-hesla`. */
  zh?: boolean
}

const encoder = new TextEncoder()

function base64urlEncode(text: string): string {
  const bytes = encoder.encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function signSession(session: Omit<Session, 'v'>, secret: string): Promise<string> {
  const content = base64urlEncode(JSON.stringify({ v: 1, ...session }))
  return `${content}.${await hmac(content, secret)}`
}

/** Returns the cookie content only when both signature and expiry check out. Otherwise `null`. */
export async function verifySession(
  value: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<Session | null> {
  if (!value || !secret) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null

  const content = value.slice(0, dot)
  const provided = value.slice(dot + 1)
  if (!equalConstantTime(provided, await hmac(content, secret))) return null

  const json = base64urlDecode(content)
  if (!json) return null

  let session: Session
  try {
    session = JSON.parse(json) as Session
  } catch {
    return null
  }

  if (session.v !== 1) return null
  if (typeof session.uid !== 'string' || typeof session.sid !== 'string') return null
  if (typeof session.exp !== 'number' || session.exp <= now) return null
  return session
}

/**
 * A fresh token once the session is past half its lifetime; otherwise `null`.
 * The `SESSION_MAX_MS` cap is enforced by the row in `sessions`, so extending
 * the cookie needs no database — which is why the proxy can do it.
 */
export async function refreshSession(
  session: Session,
  secret: string,
  now: number = Date.now(),
): Promise<string | null> {
  if (session.exp - now > SESSION_TTL_MS / 2) return null
  return signSession({ ...session, exp: now + SESSION_TTL_MS }, secret)
}


/** The `Set-Cookie` header; `null` instead of a token deletes the cookie. */
export function sessionCookie(
  token: string | null,
  env: Record<string, string | undefined> = process.env,
): string {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  if (token === null) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  }
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

/** Header that drops the cookie of the old single-password sign-in. */
export function clearLegacyCookie(env: Record<string, string | undefined> = process.env): string {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${LEGACY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

/**
 * Three sign-in states:
 *
 * - `zapnuto` (on) — `AUTH_SECRET` is set, the app is protected by accounts,
 * - `vypnuto` (off) — no secret and not deployed; this is how the app is used
 *   locally (`next dev`) and in browser tests, where sign-in would only get in
 *   the way. Writes then go under the default account, see `lib/user.ts`.
 * - `chybne-nastaveno` (misconfigured) — running on a public address without a
 *   secret. Silently opening the app to anyone would be dangerous, hence 503
 *   and an explanation.
 */
export type AuthMode = 'zapnuto' | 'vypnuto' | 'chybne-nastaveno'


export function authMode(env: Record<string, string | undefined> = process.env): AuthMode {
  if (env.AUTH_SECRET) return 'zapnuto'
  // Vercel sets `VERCEL` itself in all its environments. It is the only way
  // to tell "running on a public address" from "running on a laptop".
  if (env.VERCEL) return 'chybne-nastaveno'
  return 'vypnuto'
}

/** Without a secret the app runs unprotected — that is how we use it locally. */
export function isAuthDisabled(env?: Record<string, string | undefined>): boolean {
  return authMode(env) === 'vypnuto'
}

/** Paths reachable even when signed out. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/api/login' ||
    pathname === '/api/logout' ||
    pathname.startsWith('/api/prihlaseni/google')
  )
}

/**
 * Coarse role-based decision the proxy can make without a database:
 *
 * - school management is open to managers and administrators, school
 *   administration only to administrators,
 * - preview may read and print (printing is `GET`) but changes nothing,
 * - whoever has a forced password change may go nowhere else yet.
 *
 * Fine-grained decisions ("is this test mine?") do not belong here — server
 * functions with the database at hand make them. The proxy is a convenience,
 * not a security boundary.
 */
export function isAllowed(session: Session, pathname: string, method: string): boolean {
  const isRead = method === 'GET' || method === 'HEAD'

  if (session.zh) {
    return pathname === '/zmena-hesla' || pathname === '/api/zmena-hesla' || pathname === '/api/logout'
  }
  if (isPath(pathname, '/administrace') || pathname.startsWith('/api/administrace/')) {
    return isAdministratorRole(session.role)
  }
  if (isPath(pathname, '/sprava') || pathname.startsWith('/api/sprava/')) {
    return roleCanManage(session.role)
  }
  if (session.role === 'nahled') return isRead
  return true
}

function isPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** Comparison independent of the matching prefix length, so the signature cannot be guessed char by char. */
export function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * In-process limit on sign-in attempts. It is only a first brake against
 * guessing passwords from one address; each account has a persistent counter
 * in the database (`users.failedLogins`, `lockedUntil`), because on serverless
 * every function instance has its own memory.
 *
 * The key is the account and address pair, not the address alone: everyone
 * in the staff room comes from one IP and would otherwise lock each other out.
 */
export const LOGIN_MAX_ATTEMPTS = 10
export const LOGIN_WINDOW_MS = 15 * 60 * 1000

interface AttemptRecord {
  count: number
  /** When the window started; the counter is dropped after `LOGIN_WINDOW_MS`. */
  startedAt: number
}

const attempts = new Map<string, AttemptRecord>()

export interface LoginAttemptResult {
  allowed: boolean
  /** Seconds left until release; only when `allowed` is false. */
  retryAfterSeconds: number
  remaining: number
}

/** Records a sign-in attempt and says whether it should be processed. */
export function recordLoginAttempt(key: string, now: number = Date.now()): LoginAttemptResult {
  const record = attempts.get(key)
  if (!record || now - record.startedAt >= LOGIN_WINDOW_MS) {
    attempts.set(key, { count: 1, startedAt: now })
    return { allowed: true, retryAfterSeconds: 0, remaining: LOGIN_MAX_ATTEMPTS - 1 }
  }

  record.count += 1
  if (record.count > LOGIN_MAX_ATTEMPTS) {
    const waitMs = record.startedAt + LOGIN_WINDOW_MS - now
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
      remaining: 0,
    }
  }
  return { allowed: true, retryAfterSeconds: 0, remaining: LOGIN_MAX_ATTEMPTS - record.count }
}

/** After a successful sign-in there is no point remembering the attempts. */
export function clearLoginAttempts(key?: string): void {
  if (key === undefined) attempts.clear()
  else attempts.delete(key)
}
