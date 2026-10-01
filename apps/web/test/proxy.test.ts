import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { SESSION_COOKIE, LEGACY_COOKIE, signSession, type Role } from '@/lib/session'

/**
 * Gate behaviour by sign-in setup and role. The main thing guarded here: a
 * deployment without a secret must not silently open to anyone and preview
 * must not change anything.
 *
 * The proxy is only a coarse sieve — whether a particular test is mine is
 * decided later by the server over the database. So this is about paths and
 * methods, not data.
 */
function request(path: string, init: { headers?: Record<string, string>; method?: string } = {}): NextRequest {
  return new NextRequest(
    new Request(`https://testmaker.example${path}`, {
      headers: init.headers,
      method: init.method ?? 'GET',
    }),
  )
}

const get = (path: string, headers: Record<string, string> = {}) => request(path, { headers })

/** A request with a valid cookie of the given role. */
async function signedIn(
  path: string,
  options: { role?: Role; method?: string; zh?: boolean } = {},
): Promise<NextRequest> {
  const token = await signSession(
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
  return request(path, {
    method: options.method,
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  })
}

const original = { ...process.env }

afterEach(() => {
  for (const key of ['APP_PASSWORD', 'AUTH_SECRET', 'VERCEL', 'CRON_SECRET']) {
    delete process.env[key]
    if (original[key] !== undefined) process.env[key] = original[key]
  }
})

describe('app gate', () => {
  it('lets in without a secret outside deployment (local dev)', async () => {
    delete process.env.AUTH_SECRET
    delete process.env.VERCEL
    const response = await proxy(get('/questions'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('answers 503 without a secret in deployment and explains what is missing', async () => {
    delete process.env.AUTH_SECRET
    process.env.VERCEL = '1'
    const page = await proxy(get('/'))
    expect(page.status).toBe(503)
    expect(await page.text()).toContain('AUTH_SECRET')

    const api = await proxy(get('/api/questions'))
    expect(api.status).toBe(503)

    // Not even the login page has anything to offer — signing in is impossible.
    expect((await proxy(get('/login'))).status).toBe(503)
  })

  it('sends a signed-out user to /login and remembers where she was heading', async () => {
    process.env.AUTH_SECRET = 'secret'
    const response = await proxy(get('/questions?status=draft'))
    expect(response.status).toBe(307)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('/login')
    expect(decodeURIComponent(location)).toContain('dal=/questions?status=draft')
  })

  it('drops the old single-password cookie on the way out', async () => {
    process.env.AUTH_SECRET = 'secret'
    const response = await proxy(get('/questions'))
    expect(response.headers.get('set-cookie')).toContain(`${LEGACY_COOKIE}=`)
  })

  it('returns 401 on the API, not a redirect', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(get('/api/questions'))).status).toBe(401)
  })

  it('lets in with a valid cookie', async () => {
    process.env.AUTH_SECRET = 'secret'
    const response = await proxy(await signedIn('/questions'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('rejects a cookie signed with another secret', async () => {
    process.env.AUTH_SECRET = 'jine-tajemstvi'
    const foreign = await signedIn('/questions')
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(foreign)).status).toBe(307)
  })

  it('the login page, its API and sign-out are reachable without a cookie', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(get('/login'))).status).toBe(200)
    expect((await proxy(get('/api/login'))).status).toBe(200)
    expect((await proxy(get('/api/logout'))).status).toBe(200)
    expect((await proxy(get('/api/prihlaseni/google'))).status).toBe(200)
  })
})

describe('what each role gets through the gate', () => {
  it('lets only managers into management', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(await signedIn('/sprava/uzivatele', { role: 'spravce' }))).status).toBe(200)

    const teacher = await proxy(await signedIn('/sprava/uzivatele'))
    expect(teacher.status).toBe(307)
    expect(teacher.headers.get('location')).toMatch(/\/$/)

    const api = await proxy(
      await signedIn('/api/sprava/uzivatele', { method: 'POST' }),
    )
    expect(api.status).toBe(403)
  })

  it('the administration API looks non-existent to other roles', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(await signedIn('/api/administrace/ai', { role: 'administrator' }))).status).toBe(200)

    const teacher = await proxy(await signedIn('/api/administrace/ai'))
    expect(teacher.status).toBe(404)
    const manager = await proxy(await signedIn('/api/administrace/skoly', { role: 'spravce', method: 'POST' }))
    expect(manager.status).toBe(404)
  })

  it('preview reads and prints but may not write', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(await signedIn('/api/tests/abc/pdf', { role: 'nahled' }))).status).toBe(200)

    const write = await proxy(
      await signedIn('/api/questions', { role: 'nahled', method: 'POST' }),
    )
    expect(write.status).toBe(403)
    expect(await write.json()).toEqual({ error: 'Na tuhle akci nemáte oprávnění.' })
  })

  it('after a password reset the only way is to change the password', async () => {
    process.env.AUTH_SECRET = 'secret'
    expect((await proxy(await signedIn('/zmena-hesla', { zh: true }))).status).toBe(200)
    const elsewhere = await proxy(await signedIn('/questions', { zh: true }))
    expect(elsewhere.status).toBe(307)
    expect(elsewhere.headers.get('location')).toContain('/zmena-hesla')
  })
})

describe('sign-in bypass for the scheduler', () => {
  it('the scheduler with the shared secret gets through without a cookie', async () => {
    process.env.AUTH_SECRET = 'secret'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/jobs/run', { authorization: 'Bearer cron' }))
    expect(response.status).toBe(200)
  })

  it('rejects a wrong secret', async () => {
    process.env.AUTH_SECRET = 'secret'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/jobs/run', { authorization: 'Bearer uhodnuto' }))
    expect(response.status).toBe(401)
  })

  it('without CRON_SECRET set not even an empty header gets through', async () => {
    process.env.AUTH_SECRET = 'secret'
    delete process.env.CRON_SECRET
    expect((await proxy(get('/api/jobs/run'))).status).toBe(401)
    expect((await proxy(get('/api/jobs/run', { authorization: 'Bearer ' }))).status).toBe(401)
  })

  it('the secret applies only to the scheduler, not the rest of the API', async () => {
    process.env.AUTH_SECRET = 'secret'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/questions', { authorization: 'Bearer cron' }))
    expect(response.status).toBe(401)
  })

  it('with misconfigured sign-in not even the scheduler gets through', async () => {
    delete process.env.AUTH_SECRET
    process.env.VERCEL = '1'
    process.env.CRON_SECRET = 'cron'
    const response = await proxy(get('/api/jobs/run', { authorization: 'Bearer cron' }))
    expect(response.status).toBe(503)
  })
})
