import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { SESSION_COOKIE, STARA_COOKIE, podepsatRelaci, type Role } from '@/lib/session'

/**
 * Chování brány podle nastavení přihlašování a role. Hlavní věc, kterou tu
 * hlídáme: nasazení bez tajemství se nesmí tiše otevřít komukoli a náhled
 * nesmí nic měnit.
 *
 * Proxy je jen hrubé síto — jestli je konkrétní písemka moje, rozhoduje až
 * server nad databází. Sem se proto chodí pro cesty a metody, ne pro data.
 */
function pozadavek(path: string, init: { headers?: Record<string, string>; method?: string } = {}): NextRequest {
  return new NextRequest(
    new Request(`https://testmaker.example${path}`, {
      headers: init.headers,
      method: init.method ?? 'GET',
    }),
  )
}

const get = (path: string, headers: Record<string, string> = {}) => pozadavek(path, { headers })

/** Požadavek s platnou cookie dané role. */
async function prihlaseny(
  path: string,
  options: { role?: Role; method?: string; zh?: boolean } = {},
): Promise<NextRequest> {
  const token = await podepsatRelaci(
    {
      uid: 'ucet-1',
      sch: 'skola-1',
      sid: 'relace-1',
      role: options.role ?? 'ucitelka',
      sv: 1,
      exp: Date.now() + 60_000,
      ...(options.zh ? { zh: true } : {}),
    },
    process.env.AUTH_SECRET ?? '',
  )
  return pozadavek(path, {
    method: options.method,
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  })
}

const puvodni = { ...process.env }

afterEach(() => {
  for (const klic of ['APP_PASSWORD', 'AUTH_SECRET', 'VERCEL', 'CRON_SECRET']) {
    delete process.env[klic]
    if (puvodni[klic] !== undefined) process.env[klic] = puvodni[klic]
  }
})

describe('brána aplikace', () => {
  it('bez tajemství mimo nasazení pustí dovnitř (lokální vývoj)', async () => {
    delete process.env.AUTH_SECRET
    delete process.env.VERCEL
    const response = await proxy(get('/questions'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('bez tajemství v nasazení odpoví 503 a vysvětlí, co chybí', async () => {
    delete process.env.AUTH_SECRET
    process.env.VERCEL = '1'
    const stranka = await proxy(get('/'))
    expect(stranka.status).toBe(503)
    expect(await stranka.text()).toContain('AUTH_SECRET')

    const api = await proxy(get('/api/questions'))
    expect(api.status).toBe(503)

    // Ani přihlašovací stránka nemá co nabídnout — přihlásit se nedá.
    expect((await proxy(get('/login'))).status).toBe(503)
  })

  it('nepřihlášenou uživatelku pošle na /login a zapamatuje si, kam mířila', async () => {
    process.env.AUTH_SECRET = 'secret'
    const response = await proxy(get('/questions?status=draft'))
    expect(response.status).toBe(307)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('/login')
    expect(decodeURIComponent(location)).toContain('dal=/questions?status=draft')
  })

  it('cestou ven zahodí cookie starého přihlašování jedním heslem', async () => {
    process.env.AUTH_SECRET = 'secret'
    const response = await proxy(get('/questions'))
    expect(response.headers.get('set-cookie')).toContain(`${STARA_COOKIE}=`)
  })

  it('na API vrátí 401, ne přesměrování', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(get('/api/questions'))).status).toBe(401)
  })

  it('s platnou cookie projde dovnitř', async () => {
    process.env.AUTH_SECRET = 'secret'
    const response = await proxy(await prihlaseny('/questions'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('cookie podepsaná jiným tajemstvím neprojde', async () => {
    process.env.AUTH_SECRET = 'jine-tajemstvi'
    const cizi = await prihlaseny('/questions')
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(cizi)).status).toBe(307)
  })

  it('přihlašovací stránka, její API i odhlášení jsou dostupné bez cookie', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(get('/login'))).status).toBe(200)
    expect((await proxy(get('/api/login'))).status).toBe(200)
    expect((await proxy(get('/api/logout'))).status).toBe(200)
    expect((await proxy(get('/api/prihlaseni/google'))).status).toBe(200)
  })
})

describe('co která role projde branou', () => {
  it('do správy pustí jen správce', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(await prihlaseny('/sprava/uzivatele', { role: 'spravce' }))).status).toBe(200)

    const ucitelka = await proxy(await prihlaseny('/sprava/uzivatele'))
    expect(ucitelka.status).toBe(307)
    expect(ucitelka.headers.get('location')).toMatch(/\/$/)

    const api = await proxy(
      await prihlaseny('/api/sprava/uzivatele', { method: 'POST' }),
    )
    expect(api.status).toBe(403)
  })

  it('náhled si čte a tiskne, ale zapsat nesmí', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(await prihlaseny('/api/tests/abc/pdf', { role: 'nahled' }))).status).toBe(200)

    const zapis = await proxy(
      await prihlaseny('/api/questions', { role: 'nahled', method: 'POST' }),
    )
    expect(zapis.status).toBe(403)
    expect(await zapis.json()).toEqual({ error: 'Na tuhle akci nemáte oprávnění.' })
  })

  it('po resetu hesla se jde jedině měnit heslo', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(await prihlaseny('/zmena-hesla', { zh: true }))).status).toBe(200)
    const jinam = await proxy(await prihlaseny('/questions', { zh: true }))
    expect(jinam.status).toBe(307)
    expect(jinam.headers.get('location')).toContain('/zmena-hesla')
  })
})

describe('obejití přihlášení pro plánovač', () => {
  it('plánovač se sdíleným tajemstvím projde i bez cookie', async () => {
    process.env.AUTH_SECRET = 'secret'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/jobs/run', { authorization: 'Bearer cron' }))
    expect(response.status).toBe(200)
  })

  it('špatné tajemství neprojde', async () => {
    process.env.AUTH_SECRET = 'secret'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/jobs/run', { authorization: 'Bearer uhodnuto' }))
    expect(response.status).toBe(401)
  })

  it('bez nastaveného CRON_SECRET neprojde ani prázdná hlavička', async () => {
    process.env.AUTH_SECRET = 'secret'
    delete process.env.CRON_SECRET
    expect((await proxy(get('/api/jobs/run'))).status).toBe(401)
    expect((await proxy(get('/api/jobs/run', { authorization: 'Bearer ' }))).status).toBe(401)
  })

  it('tajemství platí jen pro plánovač, ne pro zbytek API', async () => {
    process.env.AUTH_SECRET = 'secret'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/questions', { authorization: 'Bearer cron' }))
    expect(response.status).toBe(401)
  })

  it('při chybném nastavení přihlašování neprojde ani plánovač', async () => {
    delete process.env.AUTH_SECRET
    process.env.VERCEL = '1'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/jobs/run', { authorization: 'Bearer cron' }))
    expect(response.status).toBe(503)
  })
})
