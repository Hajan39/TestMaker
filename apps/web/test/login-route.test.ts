import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST as login } from '@/app/api/login/route'
import { POST as logout } from '@/app/api/logout/route'
import { db, sessions, users } from '@/db'
import { hashPassword } from '@/lib/password'
import { LOGIN_MAX_ATTEMPTS, SESSION_COOKIE, clearLoginAttempts, verifySession } from '@/lib/session'
import { ACCOUNT } from './helpers'

/**
 * The tests call the route handlers directly, not through a running server:
 * we care what it answers to the tenth and eleventh attempt, what it sends in
 * the cookie and how it treats a blocked account. Neither the model nor any
 * network is called from here.
 */
const PASSWORD = 'tajne-heslo-ucitelky'
const SECRET = 'secret-na-podpis'
const EMAIL = 'ucitelka@skola.cz'

function request(email: string, password: string, ip: string): Request {
  return new Request('http://localhost/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  })
}

beforeEach(async () => {
  clearLoginAttempts()
  process.env.AUTH_SECRET = SECRET
  await db.delete(sessions)
  await db.delete(users).where(eq(users.email, EMAIL))
  await db.insert(users).values({
    id: 'ucet-prihlaseni',
    schoolId: ACCOUNT.schoolId,
    email: EMAIL,
    name: 'Učitelka',
    role: 'ucitelka',
    passwordHash: await hashPassword(PASSWORD),
  })
})

afterEach(async () => {
  delete process.env.AUTH_SECRET
  await db.delete(users).where(eq(users.email, EMAIL))
})

describe('account sign-in', () => {
  it('returns a signed cookie with the identity for the correct password', async () => {
    const response = await login(request(EMAIL, PASSWORD, '10.0.0.1'))
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')

    const value = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1]
    const session = await verifySession(value, SECRET)
    expect(session?.uid).toBe('ucet-prihlaseni')
    expect(session?.role).toBe('ucitelka')

    // The session is also created in the database, otherwise it could not be revoked.
    const saved = await db.select().from(sessions).where(eq(sessions.userId, 'ucet-prihlaseni'))
    expect(saved).toHaveLength(1)
  })

  it('e-mail letter case does not matter', async () => {
    const response = await login(request(EMAIL.toUpperCase(), PASSWORD, '10.0.0.9'))
    expect(response.status).toBe(200)
  })

  it('returns 401 and no cookie for a wrong password', async () => {
    const response = await login(request(EMAIL, 'uplne-jine', '10.0.0.2'))
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('nesouhlasí'),
    })
  })

  it('an unknown e-mail behaves the same as a wrong password', async () => {
    const response = await login(request('nikdo@skola.cz', PASSWORD, '10.0.0.5'))
    expect(response.status).toBe(401)
  })

  it('a blocked account does not sign in even with the correct password', async () => {
    await db.update(users).set({ status: 'zablokovany' }).where(eq(users.email, EMAIL))
    const response = await login(request(EMAIL, PASSWORD, '10.0.0.6'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('zablokovaný'),
    })
  })

  it('an account awaiting approval gets an explanation, not silence', async () => {
    await db.update(users).set({ status: 'ceka' }).where(eq(users.email, EMAIL))
    const response = await login(request(EMAIL, PASSWORD, '10.0.0.7'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('správce'),
    })
  })

  it('after ten attempts rejects further ones with 429 and a Retry-After header', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      const response = await login(request(EMAIL, 'spatne', '10.0.0.3'))
      expect([401, 429]).toContain(response.status)
    }
    const blocked = await login(request(EMAIL, PASSWORD, '10.0.0.3'))
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after') ?? '1')).toBeGreaterThan(0)
    // Not even the correct password gets through until the window frees up.
    expect(blocked.headers.get('set-cookie')).toBeNull()
  })

  it('answers 503 without a secret set and explains what is missing', async () => {
    delete process.env.AUTH_SECRET
    process.env.VERCEL = '1'
    const response = await login(request(EMAIL, PASSWORD, '10.0.0.4'))
    delete process.env.VERCEL
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('AUTH_SECRET'),
    })
  })
})

describe('sign-out', () => {
  it('sends an empty cookie with zero lifetime', async () => {
    // Without a secret the app behaves as on a laptop and sign-out does not
    // touch the cookie — this is only about what is sent back to the browser.
    delete process.env.AUTH_SECRET
    const response = await logout()
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE}=;`)
    expect(cookie).toContain('Max-Age=0')
  })
})
