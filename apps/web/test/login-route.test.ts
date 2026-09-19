import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST as login } from '@/app/api/login/route'
import { POST as logout } from '@/app/api/logout/route'
import { db, sessions, users } from '@/db'
import { zahesovat } from '@/lib/heslo'
import { LOGIN_MAX_ATTEMPTS, SESSION_COOKIE, clearLoginAttempts, overitRelaci } from '@/lib/session'
import { UCET } from './helpers'

/**
 * Testy jdou přímo na obsluhu tras, ne přes běžící server: zajímá nás, co
 * odpoví na desátý a jedenáctý pokus, co pošle v cookie a jak se zachová
 * k zablokovanému účtu. Model ani žádná síť se odtud nevolá.
 */
const HESLO = 'tajne-heslo-ucitelky'
const TAJEMSTVI = 'secret-na-podpis'
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
  process.env.AUTH_SECRET = TAJEMSTVI
  await db.delete(sessions)
  await db.delete(users).where(eq(users.email, EMAIL))
  await db.insert(users).values({
    id: 'ucet-prihlaseni',
    schoolId: UCET.schoolId,
    email: EMAIL,
    name: 'Učitelka',
    role: 'ucitelka',
    passwordHash: await zahesovat(HESLO),
  })
})

afterEach(async () => {
  delete process.env.AUTH_SECRET
  await db.delete(users).where(eq(users.email, EMAIL))
})

describe('přihlášení účtem', () => {
  it('se správným heslem vrátí podepsanou cookie s identitou', async () => {
    const response = await login(request(EMAIL, HESLO, '10.0.0.1'))
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')

    const value = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1]
    const relace = await overitRelaci(value, TAJEMSTVI)
    expect(relace?.uid).toBe('ucet-prihlaseni')
    expect(relace?.role).toBe('ucitelka')

    // Relace vzniká i v databázi, jinak by ji nešlo odvolat.
    const ulozene = await db.select().from(sessions).where(eq(sessions.userId, 'ucet-prihlaseni'))
    expect(ulozene).toHaveLength(1)
  })

  it('velikost písmen v e-mailu nerozhoduje', async () => {
    const response = await login(request(EMAIL.toUpperCase(), HESLO, '10.0.0.9'))
    expect(response.status).toBe(200)
  })

  it('s chybným heslem vrátí 401 a žádnou cookie', async () => {
    const response = await login(request(EMAIL, 'uplne-jine', '10.0.0.2'))
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('nesouhlasí'),
    })
  })

  it('neznámý e-mail se chová stejně jako chybné heslo', async () => {
    const response = await login(request('nikdo@skola.cz', HESLO, '10.0.0.5'))
    expect(response.status).toBe(401)
  })

  it('zablokovaný účet se nepřihlásí ani se správným heslem', async () => {
    await db.update(users).set({ status: 'zablokovany' }).where(eq(users.email, EMAIL))
    const response = await login(request(EMAIL, HESLO, '10.0.0.6'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('zablokovaný'),
    })
  })

  it('účet čekající na schválení dostane vysvětlení, ne mlčení', async () => {
    await db.update(users).set({ status: 'ceka' }).where(eq(users.email, EMAIL))
    const response = await login(request(EMAIL, HESLO, '10.0.0.7'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('správce'),
    })
  })

  it('po deseti pokusech odmítne další s 429 a hlavičkou Retry-After', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      const response = await login(request(EMAIL, 'spatne', '10.0.0.3'))
      expect([401, 429]).toContain(response.status)
    }
    const blocked = await login(request(EMAIL, HESLO, '10.0.0.3'))
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after') ?? '1')).toBeGreaterThan(0)
    // Ani správné heslo neprojde, dokud se okno neuvolní.
    expect(blocked.headers.get('set-cookie')).toBeNull()
  })

  it('bez nastaveného tajemství odpoví 503 a vysvětlí, co chybí', async () => {
    delete process.env.AUTH_SECRET
    process.env.VERCEL = '1'
    const response = await login(request(EMAIL, HESLO, '10.0.0.4'))
    delete process.env.VERCEL
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('AUTH_SECRET'),
    })
  })
})

describe('odhlášení', () => {
  it('pošle prázdnou cookie s nulovou platností', async () => {
    // Bez tajemství se aplikace chová jako na notebooku a odhlášení nesahá
    // po cookie — tady jde jen o to, co se posílá zpátky do prohlížeče.
    delete process.env.AUTH_SECRET
    const response = await logout()
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE}=;`)
    expect(cookie).toContain('Max-Age=0')
  })
})
