import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  authMode,
  clearLoginAttempts,
  SESSION_TTL_MS,
  isAllowed,
  refreshSession,
  verifySession,
  signSession,
  recordLoginAttempt,
  type Session,
} from '@/lib/session'

const SECRET = 'tajemstvi-na-podpis'

function session(changes: Partial<Session> = {}): Omit<Session, 'v'> {
  return {
    uid: 'ucet-1',
    sch: 'skola-1',
    sid: 'relace-1',
    role: 'ucitelka',
    sv: 1,
    exp: Date.now() + 60_000,
    ...changes,
  }
}

describe('signed session cookie', () => {
  it('reads back what was signed', async () => {
    const token = await signSession(session(), SECRET)
    const decoded = await verifySession(token, SECRET)
    expect(decoded?.uid).toBe('ucet-1')
    expect(decoded?.sid).toBe('relace-1')
    expect(decoded?.role).toBe('ucitelka')
  })

  it('rejects tampered content', async () => {
    const token = await signSession(session(), SECRET)
    const [content, hmac] = token.split('.')
    const forgery = `${Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(content!, 'base64url').toString()), role: 'spravce' }),
    ).toString('base64url')}.${hmac}`
    await expect(verifySession(forgery, SECRET)).resolves.toBeNull()
  })

  it('rejects a foreign secret, garbage and a missing cookie', async () => {
    const token = await signSession(session(), SECRET)
    await expect(verifySession(token, 'jine-tajemstvi')).resolves.toBeNull()
    await expect(verifySession('nesmysl', SECRET)).resolves.toBeNull()
    await expect(verifySession(undefined, SECRET)).resolves.toBeNull()
    await expect(verifySession(token, '')).resolves.toBeNull()
  })

  it('issues a fresh session after half its lifetime, not earlier', async () => {
    const now = Date.now()
    const fresh = { v: 1 as const, ...session({ exp: now + SESSION_TTL_MS - 1000 }) }
    await expect(refreshSession(fresh, SECRET, now)).resolves.toBeNull()

    const aging = { v: 1 as const, ...session({ exp: now + 60_000 }) }
    const token = await refreshSession(aging, SECRET, now)
    const restored = await verifySession(token ?? undefined, SECRET, now)
    expect(restored?.exp).toBe(now + SESSION_TTL_MS)
    expect(restored?.sid).toBe('relace-1')
  })

  it('rejects an expired session even with a valid signature', async () => {
    const token = await signSession(session({ exp: Date.now() - 1 }), SECRET)
    await expect(verifySession(token, SECRET)).resolves.toBeNull()
  })
})

describe('what each role may do', () => {
  const teacher = { ...session(), v: 1 } as Session
  const manager = { ...session({ role: 'spravce' }), v: 1 } as Session
  const viewer = { ...session({ role: 'nahled' }), v: 1 } as Session
  const administrator = { ...session({ role: 'administrator' }), v: 1 } as Session

  it('lets only managers and administrators into management', () => {
    expect(isAllowed(manager, '/sprava/uzivatele', 'GET')).toBe(true)
    expect(isAllowed(administrator, '/sprava', 'GET')).toBe(true)
    expect(isAllowed(administrator, '/api/sprava/skola', 'PATCH')).toBe(true)
    expect(isAllowed(teacher, '/sprava/uzivatele', 'GET')).toBe(false)
    expect(isAllowed(teacher, '/api/sprava/uzivatele', 'POST')).toBe(false)
    // A similar path prefix is not management.
    expect(isAllowed(teacher, '/spravana', 'GET')).toBe(true)
  })

  it('lets only administrators into school administration', () => {
    expect(isAllowed(administrator, '/administrace', 'GET')).toBe(true)
    expect(isAllowed(administrator, '/api/administrace/skoly', 'POST')).toBe(true)
    expect(isAllowed(manager, '/administrace', 'GET')).toBe(false)
    expect(isAllowed(manager, '/api/administrace/skola', 'POST')).toBe(false)
    expect(isAllowed(teacher, '/api/administrace/skoly', 'GET')).toBe(false)
  })

  it('preview may read and print but change nothing', () => {
    expect(isAllowed(viewer, '/api/tests/abc/pdf', 'GET')).toBe(true)
    expect(isAllowed(viewer, '/questions', 'GET')).toBe(true)
    expect(isAllowed(viewer, '/api/questions', 'POST')).toBe(false)
    expect(isAllowed(viewer, '/api/library', 'DELETE')).toBe(false)
  })

  it('worksheets: preview reads them, only a teacher may generate and change them', () => {
    expect(isAllowed(viewer, '/listy', 'GET')).toBe(true)
    expect(isAllowed(viewer, '/listy/abc', 'GET')).toBe(true)
    expect(isAllowed(viewer, '/api/worksheets/generate', 'POST')).toBe(false)
    expect(isAllowed(viewer, '/api/worksheets/abc/items/x/regenerate', 'POST')).toBe(false)
    expect(isAllowed(teacher, '/api/worksheets/generate', 'POST')).toBe(true)
    expect(isAllowed(teacher, '/listy/new', 'GET')).toBe(true)
  })

  it('a teacher may work with content', () => {
    expect(isAllowed(teacher, '/api/questions', 'POST')).toBe(true)
    expect(isAllowed(teacher, '/api/generate', 'POST')).toBe(true)
  })

  it('someone with a forced password change gets nowhere else', () => {
    const must = { ...session({ zh: true }), v: 1 } as Session
    expect(isAllowed(must, '/zmena-hesla', 'GET')).toBe(true)
    expect(isAllowed(must, '/api/zmena-hesla', 'POST')).toBe(true)
    expect(isAllowed(must, '/api/logout', 'POST')).toBe(true)
    expect(isAllowed(must, '/questions', 'GET')).toBe(false)
  })
})

describe('deciding whether sign-in is on', () => {
  it('sign-in is on with a secret', () => {
    expect(authMode({ AUTH_SECRET: 'secret' })).toBe('zapnuto')
    expect(authMode({ AUTH_SECRET: 'secret', VERCEL: '1' })).toBe('zapnuto')
  })

  it('without a secret outside deployment the app runs unprotected (local dev and tests)', () => {
    expect(authMode({})).toBe('vypnuto')
    expect(authMode({ AUTH_SECRET: '' })).toBe('vypnuto')
  })

  it('without a secret in deployment it is a misconfiguration, not a silently open app', () => {
    expect(authMode({ VERCEL: '1' })).toBe('chybne-nastaveno')
  })
})

describe('sign-in attempt limit', () => {
  beforeEach(() => clearLoginAttempts())

  it('allows ten attempts and rejects the eleventh', () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      expect(recordLoginAttempt('1.2.3.4').allowed).toBe(true)
    }
    const blocked = recordLoginAttempt('1.2.3.4')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_WINDOW_MS / 1000)
  })

  it('counts separately per account and address', () => {
    const start = Date.now()
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i += 1) recordLoginAttempt('1.2.3.4', start)
    expect(recordLoginAttempt('5.6.7.8', start).allowed).toBe(true)
  })

  it('starts counting again after fifteen minutes', () => {
    const start = Date.now()
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i += 1) recordLoginAttempt('1.2.3.4', start)
    expect(recordLoginAttempt('1.2.3.4', start + LOGIN_WINDOW_MS - 1).allowed).toBe(false)
    expect(recordLoginAttempt('1.2.3.4', start + LOGIN_WINDOW_MS).allowed).toBe(true)
  })

  it('a successful sign-in clears the counter', () => {
    const start = Date.now()
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) recordLoginAttempt('1.2.3.4', start)
    clearLoginAttempts('1.2.3.4')
    expect(recordLoginAttempt('1.2.3.4', start).allowed).toBe(true)
  })
})
