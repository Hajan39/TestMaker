import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET as back } from '@/app/api/prihlaseni/google/zpet/route'
import { GET as start } from '@/app/api/prihlaseni/google/route'
import { db, schools, users } from '@/db'
import { OAUTH_COOKIE } from '@/lib/session'
import { newOauthState, verifyIdToken, type GoogleSettings } from '@/lib/google'
import { ACCOUNT } from './helpers'

/**
 * Google sign-in. Google is never contacted here — `fetch` is faked and the
 * `id_token` is built by hand, because we verify its claims, not the signature
 * (a token from the token endpoint came over TLS straight from Google).
 */

const SETTINGS: GoogleSettings = {
  clientId: 'klient.apps.googleusercontent.com',
  clientSecret: 'tajemstvi',
  redirectUri: 'https://testmaker.example/api/prihlaseni/google/zpet',
  hd: 'skola.cz',
}

const DOMAIN = 'skola.cz'

function idToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `hlavicka.${payload}.podpis`
}

function validClaims(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: SETTINGS.clientId,
    exp: Math.floor(Date.now() / 1000) + 600,
    email: 'jana@skola.cz',
    email_verified: true,
    hd: DOMAIN,
    sub: 'google-sub-1',
    name: 'Jana Nováková',
    ...changes,
  }
}

/** A request as it returns from Google — with `state` in the address and the cookie. */
function returnPath(state: ReturnType<typeof newOauthState>, changes: { state?: string } = {}): Request {
  const url = new URL('https://testmaker.example/api/prihlaseni/google/zpet')
  url.searchParams.set('code', 'kod-od-googlu')
  url.searchParams.set('state', changes.state ?? state.state)
  return new Request(url, {
    headers: { cookie: `${OAUTH_COOKIE}=${encodeURIComponent(JSON.stringify(state))}` },
  })
}

function responseWithToken(claims: Record<string, unknown>): typeof fetch {
  return vi.fn(async () =>
    Response.json({ id_token: idToken(claims) }),
  ) as unknown as typeof fetch
}

/** Where the gate sent the browser and with which message. */
function errorFromResponse(response: Response): string {
  const location = new URL(response.headers.get('location') ?? '', 'https://testmaker.example')
  return location.searchParams.get('chyba') ?? location.searchParams.get('info') ?? ''
}

beforeEach(async () => {
  process.env.GOOGLE_CLIENT_ID = SETTINGS.clientId
  process.env.GOOGLE_CLIENT_SECRET = SETTINGS.clientSecret
  process.env.GOOGLE_REDIRECT_URI = SETTINGS.redirectUri
  process.env.GOOGLE_HD = DOMAIN
  process.env.AUTH_SECRET = 'tajemstvi-na-podpis'

  await db.update(schools).set({ googleDomain: DOMAIN, googleAutoJoin: false }).where(eq(schools.id, ACCOUNT.schoolId))
  await db.delete(users).where(eq(users.email, 'jana@skola.cz'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_HD', 'AUTH_SECRET']) {
    delete process.env[key]
  }
})

describe('leaving for Google', () => {
  it('sends the browser to Google with scope, domain and a PKCE challenge', () => {
    const response = start(new Request('https://testmaker.example/api/prihlaseni/google?dal=/tests'))
    expect(response.status).toBe(307)

    const target = new URL(response.headers.get('location') ?? '')
    expect(target.host).toBe('accounts.google.com')
    expect(target.searchParams.get('scope')).toBe('openid email profile')
    expect(target.searchParams.get('hd')).toBe(DOMAIN)
    expect(target.searchParams.get('code_challenge_method')).toBe('S256')
    expect(target.searchParams.get('code_challenge')).toBeTruthy()
    expect(response.headers.get('set-cookie')).toContain(OAUTH_COOKIE)
  })

  it('returns to sign-in with an explanation when Google is not configured', () => {
    delete process.env.GOOGLE_CLIENT_ID
    const response = start(new Request('https://testmaker.example/api/prihlaseni/google'))
    expect(errorFromResponse(response)).toContain('není v této instalaci nastavené')
  })
})

describe('verifying the token from Google', () => {
  it('accepts only a verified token for this app from the school domain', () => {
    expect(verifyIdToken(idToken(validClaims()), SETTINGS)).toMatchObject({
      identity: { email: 'jana@skola.cz', sub: 'google-sub-1' },
    })
    expect(verifyIdToken(idToken(validClaims({ aud: 'cizi-klient' })), SETTINGS)).toHaveProperty('error')
    expect(verifyIdToken(idToken(validClaims({ iss: 'https://zlo.example' })), SETTINGS)).toHaveProperty('error')
    expect(
      verifyIdToken(idToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 10 })), SETTINGS),
    ).toHaveProperty('error')
  })

  it('rejects an unverified e-mail and a foreign domain with a message', () => {
    const unverified = verifyIdToken(idToken(validClaims({ email_verified: false })), SETTINGS)
    expect(unverified).toMatchObject({ error: expect.stringContaining('neověřil') })

    const gmail = verifyIdToken(idToken(validClaims({ hd: undefined, email: 'jana@gmail.com' })), SETTINGS)
    expect(gmail).toMatchObject({ error: expect.stringContaining(DOMAIN) })
  })
})

describe('returning from Google', () => {
  it('only links an account with a password on the first sign-in', async () => {
    await db.insert(users).values({
      id: 'ucet-jana',
      schoolId: ACCOUNT.schoolId,
      email: 'jana@skola.cz',
      name: 'Jana',
      role: 'ucitelka',
    })
    vi.stubGlobal('fetch', responseWithToken(validClaims()))

    const state = newOauthState('/tests')
    const response = await back(returnPath(state))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/tests')
    expect(response.headers.get('set-cookie')).toContain('tm_relace=')

    const [account] = await db.select().from(users).where(eq(users.id, 'ucet-jana'))
    expect(account?.googleSub).toBe('google-sub-1')
  })

  it('an unknown account does not get in without the school\'s consent', async () => {
    vi.stubGlobal('fetch', responseWithToken(validClaims()))
    const state = newOauthState('/')
    const response = await back(returnPath(state))
    expect(errorFromResponse(response)).toContain('nemá v TestMakeru přístup')
    expect(await db.select().from(users).where(eq(users.email, 'jana@skola.cz'))).toHaveLength(0)
  })

  it('with auto-join on, an account awaiting approval is created', async () => {
    await db.update(schools).set({ googleAutoJoin: true }).where(eq(schools.id, ACCOUNT.schoolId))
    vi.stubGlobal('fetch', responseWithToken(validClaims()))

    const response = await back(returnPath(newOauthState('/')))
    expect(errorFromResponse(response)).toContain('správce schválí')

    const [account] = await db.select().from(users).where(eq(users.email, 'jana@skola.cz'))
    expect(account?.status).toBe('ceka')
    // No session is created until it is approved.
    expect(response.headers.get('set-cookie') ?? '').not.toContain('tm_relace=')
  })

  it('a blocked account does not sign in via Google either', async () => {
    await db.insert(users).values({
      id: 'ucet-jana-blok',
      schoolId: ACCOUNT.schoolId,
      email: 'jana@skola.cz',
      name: 'Jana',
      role: 'ucitelka',
      googleSub: 'google-sub-1',
      status: 'zablokovany',
    })
    vi.stubGlobal('fetch', responseWithToken(validClaims()))

    const response = await back(returnPath(newOauthState('/')))
    expect(errorFromResponse(response)).toContain('zablokovaný')
  })

  it('rejects a forged or missing state', async () => {
    vi.stubGlobal('fetch', responseWithToken(validClaims()))
    const state = newOauthState('/')

    const otherState = await back(returnPath(state, { state: 'uhodnuto' }))
    expect(errorFromResponse(otherState)).toContain('vypršelo')

    const withoutCookie = await back(
      new Request('https://testmaker.example/api/prihlaseni/google/zpet?code=kod&state=neco'),
    )
    expect(errorFromResponse(withoutCookie)).toContain('vypršelo')
  })

  it('ignores a return target outside the app', async () => {
    await db.insert(users).values({
      id: 'ucet-jana-2',
      schoolId: ACCOUNT.schoolId,
      email: 'jana@skola.cz',
      name: 'Jana',
      role: 'ucitelka',
      googleSub: 'google-sub-1',
    })
    vi.stubGlobal('fetch', responseWithToken(validClaims()))

    const state = { ...newOauthState('/'), dal: 'https://zlo.example/prihlaseni' }
    const response = await back(returnPath(state))
    expect(new URL(response.headers.get('location') ?? '').host).toBe('testmaker.example')
  })
})
