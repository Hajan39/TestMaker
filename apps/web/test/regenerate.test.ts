import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'
import { db, generationJobs, promptRules, questionFeedback, questions } from '@/db'
import { topicBusyMessage, regenerateQuestion } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { createPromptRule, setPromptRuleActive } from '@/lib/promptRules'
import { POST } from '@/app/api/questions/regenerate/route'
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

const REPLACEMENT: QuestionContent = {
  type: 'single_choice',
  payload: { prompt: 'Čím je poháněn koloběh vody?', options: ['Sluncem', 'Větrem'], correctIndex: 0 },
  blocks: [],
  points: 1,
  difficulty: 2,
}

/** Fake provider: a model returning exactly this one question. */
const modelReturns: typeof generateQuestions = async () => ({
  questions: [REPLACEMENT],
  rejected: [],
  chunks: 1,
  failedCalls: [],
  models: ['google:gemini-flash-latest'],
})

/** Fake provider whose call fails (exhausted quota). */
const modelFails: typeof generateQuestions = async () => {
  throw new Error('You exceeded your current quota, please check your plan')
}

/** Fake provider that answers but returns nothing usable. */
const modelReturnsNothing: typeof generateQuestions = async () => ({
  questions: [],
  rejected: [{ index: 0, errors: ['nesmysl'] }],
  chunks: 1,
  failedCalls: [],
  models: ['google:gemini-flash-latest'],
})

/** Question states of one topic — the test file shares one database. */
async function states(topicId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: questions.id, status: questions.status })
    .from(questions)
    .where(eq(questions.topicId, topicId))
  return new Map(rows.map((row) => [row.id, row.status]))
}

beforeEach(async () => {
  await db.delete(promptRules)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('replacing one question via the model', () => {
  it('passes the replaced question quote to the model so the replacement comes from the same passage', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })
    await db
      .update(questions)
      .set({ sourceFile: 'voda.pdf', sourceQuote: 'srážky a odtok vody zpět do moří' })
      .where(eq(questions.id, original))

    let focus: string | undefined = 'nezavoláno'
    await regenerateQuestion(ACCOUNT, original, {
      generate: async (request, options) => {
        focus = request.focus
        return modelReturns(request, options)
      },
    })
    expect(focus).toBe('srážky a odtok vody zpět do moří')
  })

  it('without a quote on the original no focus is passed', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })

    let focus: string | undefined = 'nezavoláno'
    await regenerateQuestion(ACCOUNT, original, {
      generate: async (request, options) => {
        focus = request.focus
        return modelReturns(request, options)
      },
    })
    expect(focus).toBeUndefined()
  })

  it('creates the replacement first, only then rejects the original', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })

    const replacement = await regenerateQuestion(ACCOUNT, original, { generate: modelReturns })

    expect(replacement.id).not.toBe(original)
    // The replacement is ready to use — draft approval is gone.
    expect(replacement.status).toBe('approved')
    expect(replacement.topicId).toBe(topicId)

    const state = await states(topicId)
    expect(state.get(original)).toBe('rejected')
    expect(state.get(replacement.id)).toBe('approved')
  })

  it('when the model fails nothing changes in the database', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })
    const before = await states(topicId)

    await expect(regenerateQuestion(ACCOUNT, original, { generate: modelFails })).rejects.toThrow(/quota/)

    const po = await states(topicId)
    expect(po).toEqual(before)
    // No extra half-written question: if one appeared the list would be longer.
    expect(po.size).toBe(1)
  })

  it('an unusable model answer does not reject the original and explains itself', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })

    await expect(regenerateQuestion(ACCOUNT, original, { generate: modelReturnsNothing })).rejects.toThrow(
      /Model nevrátil použitelnou náhradu/,
    )

    const po = await states(topicId)
    expect(po.get(original)).toBe('draft')
    expect(po.size).toBe(1)
  })

  it('is refused over a topic with running batch generation and does not block the topic', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'approved' })

    await db.insert(generationJobs).values({
      id: newId(),
      schoolId: ACCOUNT.schoolId,
      requestedBy: ACCOUNT.userId,
      topicId,
      params: { count: 5, types: ['single_choice'], difficulty: 'mix' },
      status: 'running',
    })

    await expect(regenerateQuestion(ACCOUNT, original, { generate: modelReturns })).rejects.toThrow(topicBusyMessage('Testovací správce'))

    // Only one claim remains — the replacement didn't claim the topic for itself.
    const jobs = await db.select().from(generationJobs).where(eq(generationJobs.topicId, topicId))
    expect(jobs).toHaveLength(1)
    expect((await states(topicId)).get(original)).toBe('approved')
  })

  it('a question without a topic cannot be replaced — nothing to generate from', async () => {
    const orphan = await seedQuestion(null, { status: 'draft' })
    await expect(regenerateQuestion(ACCOUNT, orphan, { generate: modelReturns })).rejects.toThrow(/téma/)
  })
})

describe('the regeneration reason affects the replacement difficulty', () => {
  it('"too hard" lowers the difficulty', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    let difficulty: unknown = 'nezavoláno'
    await regenerateQuestion(ACCOUNT, original, {
      reason: 'tezka',
      generate: async (request, options) => {
        difficulty = request.difficulty
        return modelReturns(request, options)
      },
    })
    expect(difficulty).toBe(1)
  })

  it('"too hard" at difficulty 1 does not go below the scale', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db.update(questions).set({ difficulty: 1 }).where(eq(questions.id, original))

    let difficulty: unknown = 'nezavoláno'
    await regenerateQuestion(ACCOUNT, original, {
      reason: 'tezka',
      generate: async (request, options) => {
        difficulty = request.difficulty
        return modelReturns(request, options)
      },
    })
    expect(difficulty).toBe(1)
  })

  it('"too easy" at difficulty 3 does not go above the scale', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db.update(questions).set({ difficulty: 3 }).where(eq(questions.id, original))

    let difficulty: unknown = 'nezavoláno'
    await regenerateQuestion(ACCOUNT, original, {
      reason: 'lehka',
      generate: async (request, options) => {
        difficulty = request.difficulty
        return modelReturns(request, options)
      },
    })
    expect(difficulty).toBe(3)
  })

  it('a reason without a shift (e.g. "bad Czech") keeps the difficulty', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    let difficulty: unknown = 'nezavoláno'
    await regenerateQuestion(ACCOUNT, original, {
      reason: 'cestina',
      generate: async (request, options) => {
        difficulty = request.difficulty
        return modelReturns(request, options)
      },
    })
    expect(difficulty).toBe(2)
  })
})

describe('school rules are passed to replacement generation', () => {
  it('only active rules of the own school, not disabled or foreign ones', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })

    const active = await createPromptRule(ACCOUNT, { text: 'Piš kratší zadání.' })
    const disabled = await createPromptRule(ACCOUNT, { text: 'Tohle se nepoužije.' })
    await setPromptRuleActive(ACCOUNT, disabled.id, false)

    let schoolRules: string[] | undefined
    await regenerateQuestion(ACCOUNT, original, {
      generate: async (request, options) => {
        schoolRules = request.schoolRules
        return modelReturns(request, options)
      },
    })
    expect(schoolRules).toEqual([active.text])
  })
})

describe('regeneration feedback', () => {
  it('a replacement creates a row with the replaced question model, even without a reason', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db
      .update(questions)
      .set({ model: 'google:gemini-flash-latest' })
      .where(eq(questions.id, original))

    const replacement = await regenerateQuestion(ACCOUNT, original, { generate: modelReturns })

    const [feedback] = await db
      .select()
      .from(questionFeedback)
      .where(eq(questionFeedback.questionId, original))
    expect(feedback).toBeDefined()
    expect(feedback!.replacementId).toBe(replacement.id)
    expect(feedback!.model).toBe('google:gemini-flash-latest')
    expect(feedback!.reason).toBeNull()
    expect(feedback!.note).toBeNull()
  })

  it('with a reason and a note both are saved', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })

    await regenerateQuestion(ACCOUNT, original, {
      reason: 'nesmysl',
      note: 'Ptá se na dvě věci najednou.',
      generate: modelReturns,
    })

    const [feedback] = await db
      .select()
      .from(questionFeedback)
      .where(eq(questionFeedback.questionId, original))
    expect(feedback!.reason).toBe('nesmysl')
    expect(feedback!.note).toBe('Ptá se na dvě věci najednou.')
  })

  it('a hand-written (non-AI) question creates no feedback — it says nothing about a model', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved', source: 'manual' })

    await regenerateQuestion(ACCOUNT, original, { generate: modelReturns })

    const rows = await db.select().from(questionFeedback).where(eq(questionFeedback.questionId, original))
    expect(rows).toHaveLength(0)
  })
})

describe('replacement API: invalid reason and read-only role', () => {
  it('an invalid reason in the request body is 400', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })

    const response = await POST(
      jsonReq('/api/questions/regenerate', 'POST', { id: original, reason: 'neexistujici-duvod' }),
    )
    expect(response.status).toBe(400)
  })

  it('a note without a reason is 400 with a message — without a reason the note has nowhere to go', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })

    const response = await POST(
      jsonReq('/api/questions/regenerate', 'POST', { id: original, note: 'Bez vybraného důvodu.' }),
    )
    expect(response.status).toBe(400)
    const data = (await response.json()) as { error?: string }
    expect(data.error).toMatch(/[Dd]ůvod/)
  })

  it('a viewer may not regenerate a question — 403', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    vi.stubEnv('E2E_UZIVATEL', (await seedAccount({ role: 'nahled' })).userId)

    const response = await POST(jsonReq('/api/questions/regenerate', 'POST', { id: original }))
    expect(response.status).toBe(403)
  })
})
