import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { completeQuestionAnswers } from '@testmaker/core/ai'
import { db, schools, users } from '@/db'
import { newId } from '@/lib/ids'

/**
 * Completing answers via the route handler. The real model is never called:
 * `completeQuestionAnswers` runs for real (prompt, merge, validation), only the
 * model call is stubbed and returns `model.response`.
 */

const model = vi.hoisted(() => ({
  configured: true,
  response: {} as unknown,
  prompts: [] as string[],
}))

vi.mock('@testmaker/core/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@testmaker/core/ai')>()
  return {
    ...original,
    isAiConfigured: () => model.configured,
    completeQuestionAnswers: ((request, options) =>
      original.completeQuestionAnswers(request, {
        ...options,
        models: [{ provider: 'google', model: 'podvrzeny' }],
        callModel: async ({ prompt }) => {
          model.prompts.push(prompt)
          return model.response
        },
      })) satisfies typeof completeQuestionAnswers,
  }
})

const { POST } = await import('@/app/api/questions/complete/route')
const { jsonReq, seedMaterial, seedTopic } = await import('./helpers')

const TEXT = 'Rostliny přijímají při fotosyntéze oxid uhličitý a vydávají kyslík. '.repeat(5)
const QUESTION = { type: 'short_answer', payload: { prompt: 'Jaký plyn rostliny přijímají?', answer: '', acceptedAnswers: [] } }

const complete = (body: unknown) => POST(jsonReq('/api/questions/complete', 'POST', body))

async function otherSchoolTeacher(): Promise<string> {
  const schoolId = newId()
  await db.insert(schools).values({ id: schoolId, name: 'Jiná škola', slug: `jina-${schoolId}` })
  const userId = newId()
  await db.insert(users).values({ id: userId, schoolId, email: `${userId}@localhost`, name: 'Cizí učitelka', role: 'ucitelka' })
  return userId
}

beforeEach(() => {
  model.configured = true
  model.response = {}
  model.prompts = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/questions/complete', () => {
  it('step one fills the answer from the topic materials', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'rostliny.txt', text: TEXT })
    model.response = { foundInMaterials: true, reason: 'Je to v textu.', answer: 'oxid uhličitý', acceptedAnswers: ['CO₂', 'CO2'] }

    const response = await complete({ topicId, question: QUESTION })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'filled',
      fromMaterials: true,
      question: { payload: { prompt: 'Jaký plyn rostliny přijímají?', answer: 'oxid uhličitý', acceptedAnswers: ['CO₂', 'CO2'] } },
    })
    expect(model.prompts[0]).toContain('=== rostliny.txt ===')
    expect(model.prompts[0]).toContain('Vycházej výhradně z dodaných materiálů')
  })

  it('step one reports not found and fills nothing', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    model.response = { foundInMaterials: false, reason: 'O tom materiály nemluví.', answer: 'něco' }

    const response = await complete({ topicId, question: QUESTION })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'not_found', reason: 'O tom materiály nemluví.' })
  })

  it('step two may use general knowledge and says so', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    model.response = { foundInMaterials: false, reason: 'Obecně známé.', answer: 'oxid uhličitý' }

    const response = await complete({ topicId, question: QUESTION, allowGeneralKnowledge: true })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'filled', fromMaterials: false, question: { payload: { answer: 'oxid uhličitý' } } })
    expect(model.prompts[0]).toContain('učitelka souhlasila s obecnými znalostmi')
  })

  it('without a topic step one goes straight to the confirmation', async () => {
    const response = await complete({ topicId: '', question: QUESTION })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'not_found' })
    expect(model.prompts).toEqual([])
  })

  it("another school's topic looks nonexistent", async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    vi.stubEnv('E2E_UZIVATEL', await otherSchoolTeacher())

    const response = await complete({ topicId, question: QUESTION })
    expect(response.status).toBe(404)
    expect(model.prompts).toEqual([])
  })

  it('is unavailable without a configured model', async () => {
    model.configured = false
    const { topicId } = await seedTopic()

    const response = await complete({ topicId, question: QUESTION })
    expect(response.status).toBe(503)
    expect(model.prompts).toEqual([])
  })

  it('a broken model answer is a Czech error', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    model.response = { foundInMaterials: true, reason: 'Je to v textu.' }

    const response = await complete({ topicId, question: QUESTION })
    expect(response.status).toBe(502)
    const { error } = (await response.json()) as { error: string }
    expect(error).toMatch(/nic se nezměnilo/)
  })
})
