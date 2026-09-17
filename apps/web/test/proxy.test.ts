import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { SESSION_COOKIE, sessionToken } from '@/lib/session'

/**
 * Chování brány podle nastavení přihlašování. Hlavní věc, kterou tu hlídáme:
 * nasazení bez hesla se nesmí tiše otevřít komukoli.
 */
function get(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(`https://testmaker.example${path}`, { headers }))
}

/** Požadavek s platnou přihlašovací cookie. */
async function prihlaseny(path: string): Promise<NextRequest> {
  const token = await sessionToken(process.env.APP_PASSWORD ?? '', process.env.AUTH_SECRET ?? '')
  return get(path, { cookie: `${SESSION_COOKIE}=${token}` })
}

const puvodni = { ...process.env }

afterEach(() => {
  for (const klic of ['APP_PASSWORD', 'AUTH_SECRET', 'VERCEL', 'CRON_SECRET']) {
    delete process.env[klic]
    if (puvodni[klic] !== undefined) process.env[klic] = puvodni[klic]
  }
})

describe('brána aplikace', () => {
  it('bez hesla mimo nasazení pustí dovnitř (lokální vývoj)', async () => {
    delete process.env.APP_PASSWORD
    delete process.env.VERCEL
    const response = await proxy(get('/questions'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('bez hesla v nasazení odpoví 503 a vysvětlí, co chybí', async () => {
    delete process.env.APP_PASSWORD
    process.env.VERCEL = '1'
    const stranka = await proxy(get('/'))
    expect(stranka.status).toBe(503)
    expect(await stranka.text()).toContain('APP_PASSWORD')

    const api = await proxy(get('/api/questions'))
    expect(api.status).toBe(503)

    // Ani přihlašovací stránka nemá co nabídnout — přihlásit se nedá.
    expect((await proxy(get('/login'))).status).toBe(503)
  })

  it('se zapnutým přihlašováním pošle nepřihlášenou uživatelku na /login', async () => {
    process.env.APP_PASSWORD = 'tajneheslo'
    process.env.AUTH_SECRET = 'secret'
    const response = await proxy(get('/questions'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
  })

  it('se zapnutým přihlašováním vrátí na API 401, ne přesměrování', async () => {
    process.env.APP_PASSWORD = 'tajneheslo'
    process.env.AUTH_SECRET = 'secret'
    const response = await proxy(get('/api/questions'))
    expect(response.status).toBe(401)
  })

  it('s platnou cookie projde dovnitř', async () => {
    process.env.APP_PASSWORD = 'tajneheslo'
    process.env.AUTH_SECRET = 'secret'
    const response = await proxy(await prihlaseny('/questions'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('cookie podepsaná jiným tajemstvím neprojde', async () => {
    process.env.APP_PASSWORD = 'tajneheslo'
    process.env.AUTH_SECRET = 'secret'
    const cizi = await sessionToken('tajneheslo', 'jine-tajemstvi')
    const response = await proxy(get('/questions', { cookie: `${SESSION_COOKIE}=${cizi}` }))
    expect(response.status).toBe(307)
  })

  it('přihlašovací stránka a její API jsou dostupné i bez cookie', async () => {
    process.env.APP_PASSWORD = 'tajneheslo'
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(get('/login'))).status).toBe(200)
    expect((await proxy(get('/api/login'))).status).toBe(200)
  })
})

describe('obejití přihlášení pro plánovač', () => {
  it('plánovač se sdíleným tajemstvím projde i bez cookie', async () => {
    process.env.APP_PASSWORD = 'tajneheslo'
    process.env.AUTH_SECRET = 'secret'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/jobs/run', { authorization: 'Bearer cron' }))
    expect(response.status).toBe(200)
  })

  it('špatné tajemství neprojde', async () => {
    process.env.APP_PASSWORD = 'tajneheslo'
    process.env.AUTH_SECRET = 'secret'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/jobs/run', { authorization: 'Bearer uhodnuto' }))
    expect(response.status).toBe(401)
  })

  it('bez nastaveného CRON_SECRET neprojde ani prázdná hlavička', async () => {
    process.env.APP_PASSWORD = 'tajneheslo'
    process.env.AUTH_SECRET = 'secret'
    delete process.env.CRON_SECRET
    expect((await proxy(get('/api/jobs/run'))).status).toBe(401)
    expect((await proxy(get('/api/jobs/run', { authorization: 'Bearer ' }))).status).toBe(401)
  })

  it('tajemství platí jen pro plánovač, ne pro zbytek API', async () => {
    process.env.APP_PASSWORD = 'tajneheslo'
    process.env.AUTH_SECRET = 'secret'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/questions', { authorization: 'Bearer cron' }))
    expect(response.status).toBe(401)
  })

  it('při chybném nastavení přihlašování neprojde ani plánovač', async () => {
    delete process.env.APP_PASSWORD
    process.env.AUTH_SECRET = 'secret'
    process.env.VERCEL = '1'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/jobs/run', { authorization: 'Bearer cron' }))
    expect(response.status).toBe(503)
  })
})
