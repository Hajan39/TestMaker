import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'
import { db, generationJobs, questions } from '@/db'
import { createVariant } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { POST } from '@/app/api/questions/variant/route'
import { jsonReq, seedMaterial, seedQuestion, seedTopic, seedUcet, UCET } from './helpers'

/** Prostředí s klíčem — testy na API vrstvě volání modelu stejně nespouštějí. */
function withKey(): void {
  vi.stubEnv('AI_MODELS', 'google:gemini-flash-latest')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key')
}

/** Materiál musí mít dost textu, jinak se generování odmítne ještě před modelem. */
const TEXT =
  'Koloběh vody v přírodě zahrnuje výpar, vznik oblaků, srážky a odtok vody zpět do moří a oceánů. '.repeat(
    6,
  )

const VERZE: QuestionContent = {
  type: 'single_choice',
  payload: { prompt: 'Čím je poháněn koloběh vody v jednodušší podobě?', options: ['Sluncem', 'Větrem'], correctIndex: 0 },
  blocks: [],
  points: 1,
  difficulty: 2,
}

/** Podvržený poskytovatel: model, který vrátí přesně tuhle jednu otázku. */
const modelVrati: typeof generateQuestions = async () => ({
  questions: [VERZE],
  rejected: [],
  chunks: 1,
  failedCalls: [],
  models: ['google:gemini-flash-latest'],
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('verze otázky (lehčí/těžší)', () => {
  it('vznikne s posunutou obtížností a naváže se na kořen, originál zůstává', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    let requestedDifficulty: unknown = 'nezavoláno'
    const variant = await createVariant(UCET, original, 'easier', {
      generate: async (request, options) => {
        requestedDifficulty = request.difficulty
        return modelVrati(request, options)
      },
    })

    expect(requestedDifficulty).toBe(1)
    expect(variant.id).not.toBe(original)
    expect(variant.variantOf).toBe(original)
    expect(variant.status).toBe('approved')

    const [row] = await db.select().from(questions).where(eq(questions.id, original))
    expect(row!.status).toBe('approved')
  })

  it('verze verze se naváže na kořen, ne na svého bezprostředního předchůdce', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    const harder = await createVariant(UCET, original, 'harder', { generate: modelVrati })
    expect(harder.variantOf).toBe(original)

    const easierOfHarder = await createVariant(UCET, harder.id, 'easier', { generate: modelVrati })
    expect(easierOfHarder.variantOf).toBe(original)
  })

  it('lehčí verze otázky s obtížností 1 vrátí 400', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    await db.update(questions).set({ difficulty: 1 }).where(eq(questions.id, original))

    await expect(createVariant(UCET, original, 'easier', { generate: modelVrati })).rejects.toThrow(
      /nejlehčí/,
    )
  })

  it('těžší verze otázky s obtížností 3 vrátí 400', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    await db.update(questions).set({ difficulty: 3 }).where(eq(questions.id, original))

    await expect(createVariant(UCET, original, 'harder', { generate: modelVrati })).rejects.toThrow(
      /nejtěžší/,
    )
  })

  it('zadání pro model obsahuje původní otázku a směr verze', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Kde probíhá výměna plynů?', status: 'approved' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    let variantOf: unknown = 'nezavoláno'
    await createVariant(UCET, original, 'harder', {
      generate: async (request, options) => {
        variantOf = request.variantOf
        return modelVrati(request, options)
      },
    })
    expect(variantOf).toEqual({ direction: 'harder', originalPrompt: 'Kde probíhá výměna plynů?' })
  })
})

describe('API verze otázky', () => {
  it('cizí otázka je 404', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })

    const response = await POST(
      jsonReq('/api/questions/variant', 'POST', { id: `${original}-neexistuje`, direction: 'easier' }),
    )
    expect(response.status).toBe(404)
  })

  it('neplatný směr je 400', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })

    const response = await POST(
      jsonReq('/api/questions/variant', 'POST', { id: original, direction: 'nesmysl' }),
    )
    expect(response.status).toBe(400)
  })

  it('hranice obtížnosti vrátí 400 s českou hláškou, model se nevolá', async () => {
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

  it('nad tématem s běžícím dávkovým generováním se odmítne 409', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })

    await db.insert(generationJobs).values({
      id: newId(),
      schoolId: UCET.schoolId,
      requestedBy: UCET.userId,
      topicId,
      params: { count: 5, types: ['single_choice'], difficulty: 'mix' },
      status: 'running',
    })

    const response = await POST(
      jsonReq('/api/questions/variant', 'POST', { id: original, direction: 'easier' }),
    )
    expect(response.status).toBe(409)
  })

  it('náhled otázku verzovat nesmí — 403', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved' })
    vi.stubEnv('E2E_UZIVATEL', (await seedUcet({ role: 'nahled' })).userId)

    const response = await POST(
      jsonReq('/api/questions/variant', 'POST', { id: original, direction: 'easier' }),
    )
    expect(response.status).toBe(403)
  })
})
