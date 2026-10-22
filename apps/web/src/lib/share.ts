import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, tests } from '@/db'
import { base64urlDecode, base64urlEncode, equalConstantTime, hmac } from './session'
import type { Scope } from './user'

/**
 * Time-limited print link: anyone holding it downloads the blank pupil
 * version of one test without signing in (a colleague without an account,
 * the school copier).
 *
 * The link is stateless — `base64url(JSON).hex(HMAC-SHA256)` like the session
 * cookie in `lib/session.ts`, signed with `AUTH_SECRET`. No table, so a link
 * cannot be revoked one by one; it stops working when it expires, when the
 * test is deleted, or for all links at once when `AUTH_SECRET` changes.
 */

/** How long a print link works. The dialog, the e-mail and the token all read it from here. */
export const SHARE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface ShareToken {
  /** Test id. */
  t: string
  /** School id — the test is looked up only within it. */
  s: string
  /** Expiry in milliseconds. */
  exp: number
}

/**
 * The link is signed with its own derived key, not the bare session secret,
 * so a share token can never pass as a session cookie or the other way round.
 */
const signingKey = (secret: string) => `tisk:${secret}`

/**
 * Without `AUTH_SECRET` (sign-in off, local run) there is nothing to sign
 * with — the feature is hidden, the same way the app has no sign-in then.
 */
export function shareSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.AUTH_SECRET || null
}

export async function signShareToken(payload: ShareToken, secret: string): Promise<string> {
  const content = base64urlEncode(JSON.stringify({ t: payload.t, s: payload.s, exp: payload.exp }))
  return `${content}.${await hmac(content, signingKey(secret))}`
}

/** The token content only when signature and expiry check out; otherwise `null`. */
export async function verifyShareToken(
  value: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<ShareToken | null> {
  if (!value || !secret) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const content = value.slice(0, dot)
  if (!equalConstantTime(value.slice(dot + 1), await hmac(content, signingKey(secret)))) return null

  const json = base64urlDecode(content)
  if (!json) return null
  let payload: ShareToken
  try {
    payload = JSON.parse(json) as ShareToken
  } catch {
    return null
  }
  if (typeof payload.t !== 'string' || typeof payload.s !== 'string') return null
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null
  return payload
}

/**
 * Scope for anonymous printing. The token proves access to exactly one test
 * in one school; the test is looked up by both, so a token can never read
 * another school. Printing then runs as the test's author — she issued the
 * link, so the paper is the same as her own pupil print. `null` for an
 * invalid or expired token and for a test that no longer exists.
 */
export async function resolveShareToken(
  token: string,
  now: number = Date.now(),
): Promise<{ scope: Scope; testId: string; expiresAt: number } | null> {
  const secret = shareSecret()
  if (!secret) return null
  const payload = await verifyShareToken(token, secret, now)
  if (!payload) return null

  const [row] = await db
    .select({ ownerId: tests.ownerId })
    .from(tests)
    .where(and(eq(tests.id, payload.t), eq(tests.schoolId, payload.s)))
    .limit(1)
  if (!row) return null
  return {
    scope: { schoolId: payload.s, userId: row.ownerId, role: 'ucitelka' },
    testId: payload.t,
    expiresAt: payload.exp,
  }
}

export interface ShareLink {
  url: string
  /** ISO moment the link stops working. */
  expiresAt: string
  title: string
}

/**
 * A fresh link for a test of the signed-in author. Only the author: a
 * colleague who merely sees a shared test, or anyone else, gets `null` (404
 * for the caller) — the link hands the test outside the school's accounts.
 */
export async function issueShareLink(
  scope: Scope,
  testId: string,
  origin: string,
  secret: string,
  now: number = Date.now(),
): Promise<ShareLink | null> {
  const [row] = await db
    .select({ id: tests.id, title: tests.title })
    .from(tests)
    .where(and(eq(tests.id, testId), eq(tests.schoolId, scope.schoolId), eq(tests.ownerId, scope.userId)))
    .limit(1)
  if (!row) return null

  const exp = now + SHARE_LINK_TTL_MS
  const token = await signShareToken({ t: row.id, s: scope.schoolId, exp }, secret)
  return { url: `${origin}/tisk/${token}`, expiresAt: new Date(exp).toISOString(), title: row.title }
}

/**
 * Address the link starts with. `APP_URL` wins when set (a custom domain in
 * front of Vercel); otherwise the address the request came to — behind
 * Vercel's proxy that is `x-forwarded-host`/`x-forwarded-proto`, not the
 * internal URL the function sees.
 */
export function publicOrigin(request: Request, env: Record<string, string | undefined> = process.env): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, '')
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (host) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}
