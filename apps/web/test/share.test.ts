import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { auditLog, db, schools, tests } from '@/db'
import { newId } from '@/lib/ids'
import { SHARE_LINK_TTL_MS, publicOrigin, signShareToken, verifyShareToken } from '@/lib/share'
import { resetMailLimits, MAIL_MAX_PER_HOUR } from '@/lib/mail'
import { createSession } from '@/lib/user'
import { ACCOUNT, req, seedAccount, seedTemplate } from './helpers'
import { TEST_SCHOOL_ID } from './setup'

/** The session cookie the mocked `cookies()` hands to `currentUser`. */
let cookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }),
  headers: async () => new Headers(),
}))

const render = vi.hoisted(() => vi.fn(async () => Buffer.from('%PDF-1.4 fake')))
vi.mock('@testmaker/core/pdf/node', () => ({ renderTestToBuffer: render }))

const { POST: issue } = await import('@/app/api/tests/[id]/share/route')
const { POST: email } = await import('@/app/api/tests/[id]/share/email/route')
const { GET: publicPdf } = await import('@/app/api/tisk/[token]/route')

const SECRET = 'tajemstvi-pro-odkazy'
const NOW = Date.parse('2026-10-19T10:00:00Z')
const FOREIGN_SCHOOL = 'skola-cizi-odkazy'

let templateId: string
let author: Awaited<ReturnType<typeof seedAccount>>
let colleague: Awaited<ReturnType<typeof seedAccount>>

beforeAll(async () => {
  templateId = await seedTemplate()
  author = await seedAccount()
  colleague = await seedAccount()
  await db.insert(schools).values({ id: FOREIGN_SCHOOL, name: 'Cizí škola', slug: 'cizi-odkazy' }).onConflictDoNothing()
})

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', SECRET)
  vi.stubEnv('APP_URL', '')
  vi.stubEnv('BREVO_API_KEY', '')
  vi.stubEnv('MAIL_FROM', '')
  vi.stubEnv('MAIL_FROM_NAME', '')
})

afterEach(() => {
  cookie = undefined
  render.mockClear()
  resetMailLimits()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function signIn(userId: string): Promise<void> {
  const header = await createSession(userId)
  cookie = /tm_relace=([^;]+)/.exec(header)?.[1]
}

async function seedTest(ownerId: string, options: { variants?: number; visibility?: 'skola' | 'soukrome' } = {}) {
  const id = newId()
  await db.insert(tests).values({
    id,
    schoolId: TEST_SCHOOL_ID,
    ownerId,
    title: 'Dýchací soustava',
    templateId,
    header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
    variants: options.variants ?? 1,
    visibility: options.visibility ?? 'soukrome',
  })
  return id
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) })
const tokenOf = (url: string) => url.split('/tisk/')[1]!

describe('print link token', () => {
  const payload = { t: 'test-1', s: 'skola-1', exp: NOW + 1000 }

  it('verifies its own token until it expires', async () => {
    const token = await signShareToken(payload, SECRET)
    expect(await verifyShareToken(token, SECRET, NOW)).toEqual(payload)
    expect(await verifyShareToken(token, SECRET, NOW + 1000)).toBeNull()
  })

  it('rejects a tampered payload or signature', async () => {
    const token = await signShareToken(payload, SECRET)
    const [content, signature] = token.split('.') as [string, string]
    const forged = await signShareToken({ ...payload, s: 'jina-skola' }, 'jine-tajemstvi')
    expect(await verifyShareToken(`${forged.split('.')[0]}.${signature}`, SECRET, NOW)).toBeNull()
    expect(await verifyShareToken(`${content}.${'0'.repeat(signature.length)}`, SECRET, NOW)).toBeNull()
    expect(await verifyShareToken('nesmysl', SECRET, NOW)).toBeNull()
  })

  it('rejects a token signed with another secret', async () => {
    const token = await signShareToken(payload, 'jine-tajemstvi')
    expect(await verifyShareToken(token, SECRET, NOW)).toBeNull()
  })

  it('takes the origin from APP_URL, then from the Vercel forwarded headers', () => {
    const request = req('/api/tests/x/share', {
      headers: { 'x-forwarded-host': 'testmaker.vercel.app', 'x-forwarded-proto': 'https' },
    })
    expect(publicOrigin(request, { APP_URL: 'https://testy.skola.cz/' })).toBe('https://testy.skola.cz')
    expect(publicOrigin(request, {})).toBe('https://testmaker.vercel.app')
    expect(publicOrigin(req('/x'), {})).toBe('http://localhost')
  })
})

describe('issuing a print link', () => {
  it('gives the author a link valid for seven days', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const id = await seedTest(author.userId)
    await signIn(author.userId)

    const response = await issue(req(`/api/tests/${id}/share`, { method: 'POST' }), params({ id }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { url: string; expiresAt: string }
    expect(body.url).toMatch(/^http:\/\/localhost\/tisk\//)
    expect(body.expiresAt).toBe(new Date(NOW + SHARE_LINK_TTL_MS).toISOString())
    expect(await verifyShareToken(tokenOf(body.url), SECRET, NOW)).toEqual({
      t: id,
      s: TEST_SCHOOL_ID,
      exp: NOW + SHARE_LINK_TTL_MS,
    })
  })

  it('a colleague gets 404 even for a test shared with the school', async () => {
    const id = await seedTest(author.userId, { visibility: 'skola' })
    await signIn(colleague.userId)
    const response = await issue(req(`/api/tests/${id}/share`, { method: 'POST' }), params({ id }))
    expect(response.status).toBe(404)
  })

  it('a test of another school is 404', async () => {
    const id = newId()
    await db.insert(tests).values({
      id,
      schoolId: FOREIGN_SCHOOL,
      ownerId: author.userId,
      title: 'Cizí',
      templateId,
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
    })
    await signIn(author.userId)
    const response = await issue(req(`/api/tests/${id}/share`, { method: 'POST' }), params({ id }))
    expect(response.status).toBe(404)
  })

  it('without AUTH_SECRET there is nothing to sign with', async () => {
    vi.stubEnv('AUTH_SECRET', '')
    const id = await seedTest(ACCOUNT.userId)
    const response = await issue(req(`/api/tests/${id}/share`, { method: 'POST' }), params({ id }))
    expect(response.status).toBe(503)
    expect(((await response.json()) as { error: string }).error).toContain('AUTH_SECRET')
  })
})

describe('public PDF behind the link', () => {
  async function linkFor(id: string, exp = Date.now() + SHARE_LINK_TTL_MS, school = TEST_SCHOOL_ID) {
    return signShareToken({ t: id, s: school, exp }, SECRET)
  }

  it('renders the blank pupil version without sign-in, even when the key is asked for', async () => {
    const id = await seedTest(author.userId, { variants: 2 })
    const token = await linkFor(id)
    const response = await publicPdf(req(`/api/tisk/${token}?varianta=B&key=1&filled=1`), params({ token }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        withKey: false,
        filled: false,
        variant: 'B',
        test: expect.objectContaining({ id, title: 'Dýchací soustava' }),
      }),
    )
  })

  it('an expired, tampered or foreign-school token is 404', async () => {
    const id = await seedTest(author.userId)
    const expired = await linkFor(id, Date.now() - 1)
    const valid = await linkFor(id)
    const tampered = `${valid.slice(0, -1)}${valid.endsWith('0') ? '1' : '0'}`
    const foreign = await linkFor(id, undefined, FOREIGN_SCHOOL)
    for (const token of [expired, tampered, foreign]) {
      const response = await publicPdf(req(`/api/tisk/${token}`), params({ token }))
      expect(response.status).toBe(404)
    }
    expect(render).not.toHaveBeenCalled()
  })

  it('a deleted test is 404', async () => {
    const id = await seedTest(author.userId)
    const token = await linkFor(id)
    await db.delete(tests).where(eq(tests.id, id))
    const response = await publicPdf(req(`/api/tisk/${token}`), params({ token }))
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Odkaz už neplatí')
  })
})

describe('e-mailing the link', () => {
  function configureMail() {
    vi.stubEnv('BREVO_API_KEY', 'brevo-klic')
    vi.stubEnv('MAIL_FROM', 'testmaker@skola.cz')
  }

  it('sends the link to the signed-in author, not to an address from the request', async () => {
    configureMail()
    const fetchMock = vi.fn(async () => new Response('{"messageId":"1"}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const id = await seedTest(author.userId)
    await signIn(author.userId)

    const response = await email(
      req(`/api/tests/${id}/share/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'utocnik@example.com' }),
      }),
      params({ id }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ email: author.email })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect((init.headers as Record<string, string>)['api-key']).toBe('brevo-klic')
    const sent = JSON.parse(String(init.body)) as {
      sender: { email: string; name: string }
      to: { email: string }[]
      subject: string
      textContent: string
    }
    expect(sent.sender).toEqual({ email: 'testmaker@skola.cz', name: 'TestMaker' })
    expect(sent.to).toEqual([{ email: author.email, name: author.name }])
    expect(sent.subject).toBe('Odkaz na tisk: Dýchací soustava')
    expect(sent.textContent).toMatch(/http:\/\/localhost\/tisk\/\S+/)
    expect(sent.textContent).toContain('jen zadání pro žáky')
  })

  it('answers 503 when e-mail is not configured and calls nobody', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const id = await seedTest(author.userId)
    await signIn(author.userId)
    const response = await email(req(`/api/tests/${id}/share/email`, { method: 'POST' }), params({ id }))
    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a Brevo error becomes 502 with Czech advice and an audit entry', async () => {
    configureMail()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"sender not verified"}', { status: 400 })))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const id = await seedTest(author.userId)
    await signIn(author.userId)

    const response = await email(req(`/api/tests/${id}/share/email`, { method: 'POST' }), params({ id }))
    expect(response.status).toBe(502)
    expect(((await response.json()) as { error: string }).error).toContain('E-mail se nepodařilo odeslat')
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.entityId, id))
    expect(entry?.action).toBe('odkaz-e-mailem-chyba')
    expect(logged).toHaveBeenCalledWith('Print link e-mail failed:', expect.stringContaining('Brevo 400'))
    logged.mockRestore()
  })

  it('a colleague cannot mail herself someone else’s test', async () => {
    configureMail()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const id = await seedTest(author.userId, { visibility: 'skola' })
    await signIn(colleague.userId)
    const response = await email(req(`/api/tests/${id}/share/email`, { method: 'POST' }), params({ id }))
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it(`stops after ${MAIL_MAX_PER_HOUR} e-mails an hour`, async () => {
    configureMail()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })))
    const id = await seedTest(author.userId)
    await signIn(author.userId)
    const statuses: number[] = []
    for (let i = 0; i <= MAIL_MAX_PER_HOUR; i += 1) {
      statuses.push((await email(req(`/api/tests/${id}/share/email`, { method: 'POST' }), params({ id }))).status)
    }
    expect(statuses).toEqual([...Array<number>(MAIL_MAX_PER_HOUR).fill(200), 429])
  })
})
