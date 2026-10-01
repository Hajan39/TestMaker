import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET as source } from '@/app/api/topics/[id]/zdroj/route'
import { POST as upload } from '@/app/api/topics/[id]/otazky-soubor/route'
import { db, schools, users } from '@/db'
import { newId } from '@/lib/ids'
import { req, seedMaterial, seedTopic, seedAccount } from './helpers'

/**
 * Downloading materials and uploading questions from Claude Code via the route
 * handlers: roles, school scope and file errors. Sign-in is disabled in tests,
 * so we impersonate another account via `E2E_UZIVATEL` (the default account
 * without sign-in), just like the browser tests.
 */

const TEXT = 'Houby nemají chlorofyl, a proto si potravu nevyrábějí samy. '.repeat(8)

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function file(topicId: string, body: string): Request {
  return req(`/api/topics/${topicId}/otazky-soubor`, { method: 'POST', body })
}

/** A teacher from another school — a foreign topic must not exist for her. */
async function otherSchoolTeacher(): Promise<string> {
  const schoolId = newId()
  await db.insert(schools).values({ id: schoolId, name: 'Jiná škola', slug: `jina-${schoolId}` })
  const userId = newId()
  await db.insert(users).values({
    id: userId,
    schoolId,
    email: `${userId}@localhost`,
    name: 'Cizí učitelka',
    role: 'ucitelka',
  })
  return userId
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('downloading topic materials for Claude Code', () => {
  it('returns the text with a header and the materials', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })

    const response = await source(req(`/api/topics/${topicId}/zdroj`), params(topicId))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    const text = await response.text()
    expect(text).toMatch(/^# Předmět: /)
    expect(text).toContain('=== houby.pdf ===')
  })

  it('a viewer may download materials — it only reads', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    vi.stubEnv('E2E_UZIVATEL', (await seedAccount({ role: 'nahled' })).userId)

    const response = await source(req(`/api/topics/${topicId}/zdroj`), params(topicId))
    expect(response.status).toBe(200)
  })

  it("another school's topic looks nonexistent", async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    vi.stubEnv('E2E_UZIVATEL', await otherSchoolTeacher())

    const response = await source(req(`/api/topics/${topicId}/zdroj`), params(topicId))
    expect(response.status).toBe(404)
  })
})

describe('uploading questions from Claude Code', () => {
  const VALID = JSON.stringify({
    questions: [
      {
        type: 'short_answer',
        payload: { prompt: 'Co houbám chybí?', answer: 'chlorofyl' },
        evidence: { fileName: 'houby.pdf', quote: 'Houby nemají chlorofyl' },
      },
    ],
  })

  it('imports a valid file and reports how many questions were added', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })

    const response = await upload(file(topicId, VALID), params(topicId))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ created: 1, rejected: [] })
  })

  it('a viewer may not upload — 403', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    vi.stubEnv('E2E_UZIVATEL', (await seedAccount({ role: 'nahled' })).userId)

    const response = await upload(file(topicId, VALID), params(topicId))
    expect(response.status).toBe(403)
  })

  it("uploads nothing into another school's topic — 404", async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    vi.stubEnv('E2E_UZIVATEL', await otherSchoolTeacher())

    const response = await upload(file(topicId, VALID), params(topicId))
    expect(response.status).toBe(404)
  })

  it('invalid JSON returns 400 with a Czech message saying what to do', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })

    const response = await upload(file(topicId, '{nejde'), params(topicId))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('není platný JSON')
  })
})
