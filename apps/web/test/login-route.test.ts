import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { POST as login } from '@/app/api/login/route'
import { POST as logout } from '@/app/api/logout/route'
import { LOGIN_MAX_ATTEMPTS, SESSION_COOKIE, clearLoginAttempts, isValidSession } from '@/lib/session'

/**
 * Testy jdou přímo na obsluhu tras, ne přes běžící server: zajímá nás, co
 * odpoví na desátý a jedenáctý pokus a co pošle v cookie.
 */
const HESLO = 'tajne-heslo-ucitelky'
const TAJEMSTVI = 'secret-na-podpis'

function request(password: string, ip: string): Request {
  return new Request('http://localhost/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ password }),
  })
}

beforeEach(() => {
  clearLoginAttempts()
  process.env.APP_PASSWORD = HESLO
  process.env.AUTH_SECRET = TAJEMSTVI
})

afterEach(() => {
  delete process.env.APP_PASSWORD
  delete process.env.AUTH_SECRET
})

describe('přihlášení heslem', () => {
  it('se správným heslem vrátí podepsanou cookie', async () => {
    const response = await login(request(HESLO, '10.0.0.1'))
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    const value = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1]
    await expect(isValidSession(value, HESLO, TAJEMSTVI)).resolves.toBe(true)
  })

  it('s chybným heslem vrátí 401 a žádnou cookie', async () => {
    const response = await login(request('uplne-jine', '10.0.0.2'))
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Heslo') })
  })

  it('po deseti pokusech odmítne další s 429 a hlavičkou Retry-After', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      const response = await login(request('spatne', '10.0.0.3'))
      expect(response.status).toBe(401)
    }
    const blocked = await login(request(HESLO, '10.0.0.3'))
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    // Ani správné heslo neprojde, dokud se okno neuvolní.
    expect(blocked.headers.get('set-cookie')).toBeNull()
  })

  it('bez nastaveného tajemství odpoví 503 a vysvětlí, co chybí', async () => {
    delete process.env.AUTH_SECRET
    const response = await login(request(HESLO, '10.0.0.4'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('AUTH_SECRET'),
    })
  })
})

describe('odhlášení', () => {
  it('pošle prázdnou cookie s nulovou platností', async () => {
    const response = await logout()
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE}=;`)
    expect(cookie).toContain('Max-Age=0')
  })
})
