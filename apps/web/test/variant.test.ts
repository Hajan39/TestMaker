import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'
import { db, generationJobs, questions } from '@/db'
import { createVariant } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { POST } from '@/app/api/questions/variant/route'
import { jsonReq, seedMaterial, seedQuestion, seedTopic, seedAccount, ACCOUNT } from './helpers'

/** Environment with a key — API-level tests never call the model anyway. */
function withKey(): void {
  vi.stubEnv('AI_MODELS', 'google:gemini-flash-latest')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key')
}

/** The material needs enough text, otherwise generation is refused before the model. */
const TEXT =
  'Koloběh vody v přírodě zahrnuje výpar, vznik oblaků, srážky a odtok vody zpět do moří a oceánů. '.repeat(
    6,
  )

const VERSION: QuestionContent = {
  type: 'single_choice',
  payload: { prompt: 'Čím je poháněn koloběh vody v jednodušší podobě?', options: ['Sluncem', 'Větrem'], correctIndex: 0 },
  blocks: [],
  points: 1,
  difficulty: 2,
}

/** Fake provider: a model returning exactly this one question. */
const modelReturns: typeof generateQuestions = async () => ({
  questions: [VERSION],
  rejected: [],
  chunks: 1,
  failedCalls: [],
  models: ['google:gemini-flash-latest'],
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('question variant (easier/harder)', () => {
  it('is created with shifted difficulty and linked to the root, the original stays', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    let requestedDifficulty: unknown = 'nezavoláno'
    const variant = await createVariant(ACCOUNT, original, 'easier', {
      generate: async (request, options) => {
        requestedDifficulty = request.difficulty
        return modelReturns(request, options)
      },
    })

    expect(requestedDifficulty).toBe(1)
    // The fake model returns difficulty 2 (the original) — 1 must be stored.
    expect(VERSION.difficulty).toBe(2)
    expect(variant.difficulty).toBe(1)
    expect(variant.id).not.toBe(original)
    expect(variant.variantOf).toBe(original)
    expect(variant.status).toBe('approved')

    const [row] = await db.select().from(questions).where(eq(questions.id, original))
    expect(row!.status).toBe('approved')
  })

  it('a variant of a variant links to the root, not its immediate predecessor', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    const harder = await createVariant(ACCOUNT, original, 'harder', { generate: modelReturns })
    expect(harder.variantOf).toBe(original)
    expect(harder.difficulty).toBe(3)

    const easierOfHarder = await createVariant(ACCOUNT, harder.id, 'easier', { generate: modelReturns })
    expect(easierOfHarder.variantOf).toBe(original)
  })

  it('an easier variant of a difficulty-1 question returns 400', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    await db.update(questions).set({ difficulty: 1 }).where(eq(questions.id, original))

    await expect(createVariant(ACCOUNT, original, 'easier', { generate: modelReturns })).rejects.toThrow(
      /nejlehčí/,
    )
  })

  it('a harder variant of a difficulty-3 question returns 400', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    await db.update(questions).set({ difficulty: 3 }).where(eq(questions.id, original))

    await expect(createVariant(ACCOUNT, original, 'harder', { generate: modelReturns })).rejects.toThrow(
      /nejtěžší/,
    )
  })

  it('the model request contains the original question and the variant direction', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Kde probíhá výměna plynů?', status: 'approved' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    let variantOf: unknown = 'nezavoláno'
    await createVariant(ACCOUNT, original, 'harder', {
      generate: async (request, options) => {
        variantOf = request.variantOf
        return modelReturns(request, options)
      },
    })
    expect(variantOf).toEqual({ direction: 'harder', originalPrompt: 'Kde probíhá výměna plynů?' })
  })
})

describe('question variant API', () => {
  it('a foreign question is 404', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })

    const response = await POST(
      jsonReq('/api/questions/variant', 'POST', { id: `${original}-neexistuje`, direction: 'easier' }),
    )
    expect(response.status).toBe(404)
  })

  it('an invalid direction is 400', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })

    const response = await POST(
      jsonReq('/api/questions/variant', 'POST', { id: original, direction: 'nesmysl' }),
    )
    expect(response.status).toBe(400)
  })

  it('the difficulty limit returns 400 with a message, the model is not called', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    await db.update(questions).set({ difficulty: 3 }).where(eq(questions.id, original))

    const response = await POST(
      jsonReq('/api/questions/variant', 'POST', { id: original, direction: 'harder' }),
    )
    expect(response.status).toBe(400)
    const data = (await response.json()) as { error?: string }
    expect(data.error).toMatch(/nejtěžší/)
  })

  it('is refused with 409 over a topic with running batch generation', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })

    await db.insert(generationJobs).values({
      id: newId(),
      schoolId: ACCOUNT.schoolId,
      requestedBy: ACCOUNT.userId,
      topicId,
      params: { count: 5, types: ['single_choice'], difficulty: 'mix' },
      status: 'running',
    })

    const response = await POST(
      jsonReq('/api/questions/variant', 'POST', { id: original, direction: 'easier' }),
    )
    expect(response.status).toBe(409)
  })

  it('a viewer may not create variants — 403', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    vi.stubEnv('E2E_UZIVATEL', (await seedAccount({ role: 'nahled' })).userId)

    const response = await POST(
      jsonReq('/api/questions/variant', 'POST', { id: original, direction: 'easier' }),
    )
    expect(response.status).toBe(403)
  })
})
