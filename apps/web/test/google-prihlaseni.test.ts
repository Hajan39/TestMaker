import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET as zpet } from '@/app/api/prihlaseni/google/zpet/route'
import { GET as start } from '@/app/api/prihlaseni/google/route'
import { db, schools, users } from '@/db'
import { OAUTH_COOKIE } from '@/lib/session'
import { novyOauthStav, overitIdToken, type GoogleNastaveni } from '@/lib/google'
import { UCET } from './helpers'

/**
 * Přihlášení přes Google. Na Google se tu nikdy nechodí — `fetch` je
 * podvržený a `id_token` se skládá ručně, protože ověřujeme jeho nároky,
 * ne podpis (token z tokenového endpointu přišel přes TLS přímo od Googlu).
 */

const NASTAVENI: GoogleNastaveni = {
  clientId: 'klient.apps.googleusercontent.com',
  clientSecret: 'tajemstvi',
  redirectUri: 'https://testmaker.example/api/prihlaseni/google/zpet',
  hd: 'skola.cz',
}

const DOMENA = 'skola.cz'

function idToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `hlavicka.${payload}.podpis`
}

function platneNaroky(zmeny: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: NASTAVENI.clientId,
    exp: Math.floor(Date.now() / 1000) + 600,
    email: 'jana@skola.cz',
    email_verified: true,
    hd: DOMENA,
    sub: 'google-sub-1',
    name: 'Jana Nováková',
    ...zmeny,
  }
}

/** Požadavek, jak se vrací od Googlu — se `state` v adrese i v cookie. */
function navrat(stav: ReturnType<typeof novyOauthStav>, zmeny: { state?: string } = {}): Request {
  const url = new URL('https://testmaker.example/api/prihlaseni/google/zpet')
  url.searchParams.set('code', 'kod-od-googlu')
  url.searchParams.set('state', zmeny.state ?? stav.state)
  return new Request(url, {
    headers: { cookie: `${OAUTH_COOKIE}=${encodeURIComponent(JSON.stringify(stav))}` },
  })
}

function odpovedSTokenem(claims: Record<string, unknown>): typeof fetch {
  return vi.fn(async () =>
    Response.json({ id_token: idToken(claims) }),
  ) as unknown as typeof fetch
}

/** Kam brána poslala prohlížeč a s jakou hláškou. */
function chybaZOdpovedi(response: Response): string {
  const location = new URL(response.headers.get('location') ?? '', 'https://testmaker.example')
  return location.searchParams.get('chyba') ?? ''
}

beforeEach(async () => {
  process.env.GOOGLE_CLIENT_ID = NASTAVENI.clientId
  process.env.GOOGLE_CLIENT_SECRET = NASTAVENI.clientSecret
  process.env.GOOGLE_REDIRECT_URI = NASTAVENI.redirectUri
  process.env.GOOGLE_HD = DOMENA
  process.env.AUTH_SECRET = 'tajemstvi-na-podpis'

  await db.update(schools).set({ googleDomain: DOMENA, googleAutoJoin: false }).where(eq(schools.id, UCET.schoolId))
  await db.delete(users).where(eq(users.email, 'jana@skola.cz'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const klic of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_HD', 'AUTH_SECRET']) {
    delete process.env[klic]
  }
})

describe('odchod na Google', () => {
  it('pošle prohlížeč na Google se scope, doménou a výzvou PKCE', () => {
    const response = start(new Request('https://testmaker.example/api/prihlaseni/google?dal=/tests'))
    expect(response.status).toBe(307)

    const cil = new URL(response.headers.get('location') ?? '')
    expect(cil.host).toBe('accounts.google.com')
    expect(cil.searchParams.get('scope')).toBe('openid email profile')
    expect(cil.searchParams.get('hd')).toBe(DOMENA)
    expect(cil.searchParams.get('code_challenge_method')).toBe('S256')
    expect(cil.searchParams.get('code_challenge')).toBeTruthy()
    expect(response.headers.get('set-cookie')).toContain(OAUTH_COOKIE)
  })

  it('bez nastavení Googlu se vrátí na přihlášení s vysvětlením', () => {
    delete process.env.GOOGLE_CLIENT_ID
    const response = start(new Request('https://testmaker.example/api/prihlaseni/google'))
    expect(chybaZOdpovedi(response)).toContain('není v této instalaci nastavené')
  })
})

describe('ověření tokenu od Googlu', () => {
  it('projde jen token pro tuhle aplikaci, ověřený a ze školní domény', () => {
    expect(overitIdToken(idToken(platneNaroky()), NASTAVENI)).toMatchObject({
      identita: { email: 'jana@skola.cz', sub: 'google-sub-1' },
    })
    expect(overitIdToken(idToken(platneNaroky({ aud: 'cizi-klient' })), NASTAVENI)).toHaveProperty('chyba')
    expect(overitIdToken(idToken(platneNaroky({ iss: 'https://zlo.example' })), NASTAVENI)).toHaveProperty('chyba')
    expect(
      overitIdToken(idToken(platneNaroky({ exp: Math.floor(Date.now() / 1000) - 10 })), NASTAVENI),
    ).toHaveProperty('chyba')
  })

  it('neověřený e-mail a cizí doména se odmítnou česky', () => {
    const neovereny = overitIdToken(idToken(platneNaroky({ email_verified: false })), NASTAVENI)
    expect(neovereny).toMatchObject({ chyba: expect.stringContaining('neověřil') })

    const gmail = overitIdToken(idToken(platneNaroky({ hd: undefined, email: 'jana@gmail.com' })), NASTAVENI)
    expect(gmail).toMatchObject({ chyba: expect.stringContaining(DOMENA) })
  })
})

describe('návrat od Googlu', () => {
  it('účet s heslem se při prvním přihlášení jen spáruje', async () => {
    await db.insert(users).values({
      id: 'ucet-jana',
      schoolId: UCET.schoolId,
      email: 'jana@skola.cz',
      name: 'Jana',
      role: 'ucitelka',
    })
    vi.stubGlobal('fetch', odpovedSTokenem(platneNaroky()))

    const stav = novyOauthStav('/tests')
    const response = await zpet(navrat(stav))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/tests')
    expect(response.headers.get('set-cookie')).toContain('tm_relace=')

    const [ucet] = await db.select().from(users).where(eq(users.id, 'ucet-jana'))
    expect(ucet?.googleSub).toBe('google-sub-1')
  })

  it('neznámý účet se bez souhlasu školy dovnitř nedostane', async () => {
    vi.stubGlobal('fetch', odpovedSTokenem(platneNaroky()))
    const stav = novyOauthStav('/')
    const response = await zpet(navrat(stav))
    expect(chybaZOdpovedi(response)).toContain('nemá v TestMakeru přístup')
    expect(await db.select().from(users).where(eq(users.email, 'jana@skola.cz'))).toHaveLength(0)
  })

  it('se zapnutým automatickým zavedením vznikne účet čekající na schválení', async () => {
    await db.update(schools).set({ googleAutoJoin: true }).where(eq(schools.id, UCET.schoolId))
    vi.stubGlobal('fetch', odpovedSTokenem(platneNaroky()))

    const response = await zpet(navrat(novyOauthStav('/')))
    expect(chybaZOdpovedi(response)).toContain('správce schválí')

    const [ucet] = await db.select().from(users).where(eq(users.email, 'jana@skola.cz'))
    expect(ucet?.status).toBe('ceka')
    // Dokud není schválený, relace nevzniká.
    expect(response.headers.get('set-cookie') ?? '').not.toContain('tm_relace=')
  })

  it('zablokovaný účet se nepřihlásí ani přes Google', async () => {
    await db.insert(users).values({
      id: 'ucet-jana-blok',
      schoolId: UCET.schoolId,
      email: 'jana@skola.cz',
      name: 'Jana',
      role: 'ucitelka',
      googleSub: 'google-sub-1',
      status: 'zablokovany',
    })
    vi.stubGlobal('fetch', odpovedSTokenem(platneNaroky()))

    const response = await zpet(navrat(novyOauthStav('/')))
    expect(chybaZOdpovedi(response)).toContain('zablokovaný')
  })

  it('podvržený nebo chybějící stav se odmítne', async () => {
    vi.stubGlobal('fetch', odpovedSTokenem(platneNaroky()))
    const stav = novyOauthStav('/')

    const jinyState = await zpet(navrat(stav, { state: 'uhodnuto' }))
    expect(chybaZOdpovedi(jinyState)).toContain('vypršelo')

    const bezCookie = await zpet(
      new Request('https://testmaker.example/api/prihlaseni/google/zpet?code=kod&state=neco'),
    )
    expect(chybaZOdpovedi(bezCookie)).toContain('vypršelo')
  })

  it('návrat mimo aplikaci se ignoruje', async () => {
    await db.insert(users).values({
      id: 'ucet-jana-2',
      schoolId: UCET.schoolId,
      email: 'jana@skola.cz',
      name: 'Jana',
      role: 'ucitelka',
      googleSub: 'google-sub-1',
    })
    vi.stubGlobal('fetch', odpovedSTokenem(platneNaroky()))

    const stav = { ...novyOauthStav('/'), dal: 'https://zlo.example/prihlaseni' }
    const response = await zpet(navrat(stav))
    expect(new URL(response.headers.get('location') ?? '').host).toBe('testmaker.example')
  })
})
