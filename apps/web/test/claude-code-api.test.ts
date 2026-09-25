import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET as zdroj } from '@/app/api/topics/[id]/zdroj/route'
import { POST as nahrat } from '@/app/api/topics/[id]/otazky-soubor/route'
import { db, schools, users } from '@/db'
import { newId } from '@/lib/ids'
import { req, seedMaterial, seedTopic, seedUcet } from './helpers'

/**
 * Stažení materiálů a nahrání otázek z Claude Code přes route handlery:
 * role, rozsah školy a chyby souboru. Přihlašování je v testech vypnuté,
 * takže se za jiný účet vydáváme přes `E2E_UZIVATEL` (výchozí účet bez
 * přihlášení), stejně jako prohlížečové testy.
 */

const TEXT = 'Houby nemají chlorofyl, a proto si potravu nevyrábějí samy. '.repeat(8)

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function soubor(topicId: string, body: string): Request {
  return req(`/api/topics/${topicId}/otazky-soubor`, { method: 'POST', body })
}

/** Učitelka z jiné školy — cizí téma pro ni nesmí existovat. */
async function ucitelkaJineSkoly(): Promise<string> {
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

describe('stažení materiálů tématu pro Claude Code', () => {
  it('vrátí text s hlavičkou a materiály', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })

    const response = await zdroj(req(`/api/topics/${topicId}/zdroj`), params(topicId))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    const text = await response.text()
    expect(text).toMatch(/^# Předmět: /)
    expect(text).toContain('=== houby.pdf ===')
  })

  it('náhled si materiály stáhnout smí — jen čte', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    vi.stubEnv('E2E_UZIVATEL', (await seedUcet({ role: 'nahled' })).userId)

    const response = await zdroj(req(`/api/topics/${topicId}/zdroj`), params(topicId))
    expect(response.status).toBe(200)
  })

  it('téma cizí školy se tváří jako neexistující', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    vi.stubEnv('E2E_UZIVATEL', await ucitelkaJineSkoly())

    const response = await zdroj(req(`/api/topics/${topicId}/zdroj`), params(topicId))
    expect(response.status).toBe(404)
  })
})

describe('nahrání otázek z Claude Code', () => {
  const PLATNY = JSON.stringify({
    questions: [
      {
        type: 'short_answer',
        payload: { prompt: 'Co houbám chybí?', answer: 'chlorofyl' },
        evidence: { fileName: 'houby.pdf', quote: 'Houby nemají chlorofyl' },
      },
    ],
  })

  it('platný soubor nahraje a řekne, kolik otázek přibylo', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })

    const response = await nahrat(soubor(topicId, PLATNY), params(topicId))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ created: 1, rejected: [] })
  })

  it('náhled nahrávat nesmí — 403', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    vi.stubEnv('E2E_UZIVATEL', (await seedUcet({ role: 'nahled' })).userId)

    const response = await nahrat(soubor(topicId, PLATNY), params(topicId))
    expect(response.status).toBe(403)
  })

  it('do tématu cizí školy nic nenahraje — 404', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    vi.stubEnv('E2E_UZIVATEL', await ucitelkaJineSkoly())

    const response = await nahrat(soubor(topicId, PLATNY), params(topicId))
    expect(response.status).toBe(404)
  })

  it('neplatný JSON vrátí 400 s českou hláškou, co s tím', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })

    const response = await nahrat(soubor(topicId, '{nejde'), params(topicId))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('není platný JSON')
  })
})
