import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { generateQuestions } from '@testmaker/core/ai'
import type { QuestionContent } from '@testmaker/core/schema'
import { db, materials, promptRules, topics, questions } from '@/db'
import { generateForTopic, DEFAULT_GENERATE_PARAMS, loadTopicSource } from '@/lib/generation'
import { recomputeTopicContent } from '@/lib/duplicates'
import { topicSourceFile } from '@/lib/questionFile'
import { createPromptRule } from '@/lib/promptRules'
import { seedMaterial, seedTopic, ACCOUNT } from './helpers'

beforeEach(async () => {
  await db.delete(promptRules)
})

/**
 * The model ladder from the app's point of view: what got saved to the database
 * when the first model runs out of quota mid-topic. No real model is called —
 * generation is injected so the tests don't use up quota.
 */

const TEXT =
  'Koloběh vody v přírodě zahrnuje výpar, vznik oblaků, srážky a odtok vody zpět do moří a oceánů. '.repeat(6)

function question(order: number): QuestionContent {
  return {
    type: 'short_answer',
    payload: { prompt: `Otázka číslo ${order}?`, answer: 'odpověď', acceptedAnswers: [] },
    blocks: [],
    points: 1,
    difficulty: 2,
  }
}

/**
 * Fake generation behaving like `generateQuestions` after an exhausted quota:
 * the first batch comes from the first model, the second from the next one in the ladder.
 */
const twoModels: typeof generateQuestions = async (_request, options) => {
  const first = [question(1), question(2)]
  const second = [question(3), question(4)]
  await options?.onBatch?.(first, { model: 'google:gemini-flash-latest' })
  await options?.onBatch?.(second, { model: 'google:gemini-flash-lite-latest' })
  return {
    questions: [...first, ...second],
    rejected: [],
    chunks: 1,
    failedCalls: [],
    models: ['google:gemini-flash-latest', 'google:gemini-flash-lite-latest'],
  }
}

describe('topic generation with a model ladder', () => {
  it('saves questions from both models and returns which were used', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const outcome = await generateForTopic(ACCOUNT, 
      topicId,
      { ...DEFAULT_GENERATE_PARAMS, count: 4 },
      { generate: twoModels },
    )

    expect(outcome.created).toBe(4)
    // Quality differs between models — the result must show they were mixed.
    expect(outcome.models).toEqual(['google:gemini-flash-latest', 'google:gemini-flash-lite-latest'])

    const rows = await db
      .select({ model: questions.model, status: questions.status })
      .from(questions)
      .where(eq(questions.topicId, topicId))
    expect(rows).toHaveLength(4)
    // The model is stored with the question, but only in the database — the UI never uses it.
    expect(rows.filter((row) => row.model === 'google:gemini-flash-latest')).toHaveLength(2)
    expect(rows.filter((row) => row.model === 'google:gemini-flash-lite-latest')).toHaveLength(2)
    // Questions are created ready to use, not as drafts awaiting approval.
    expect(rows.every((row) => row.status === 'approved')).toBe(true)
  })

  it('when generation fails midway, finished batches stay saved', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    // The whole ladder ran out: the first batch is saved, the second never came.
    const failsAfterFirstBatch: typeof generateQuestions = async (_request, options) => {
      await options?.onBatch?.([question(1), question(2)], { model: 'google:gemini-flash-latest' })
      throw new Error('You exceeded your current quota, please check your plan')
    }

    await expect(
      generateForTopic(ACCOUNT, topicId, { ...DEFAULT_GENERATE_PARAMS, count: 4 }, { generate: failsAfterFirstBatch }),
    ).rejects.toThrow(/quota/)

    const rows = await db.select({ id: questions.id, model: questions.model }).from(questions).where(eq(questions.topicId, topicId))
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.model === 'google:gemini-flash-latest')).toBe(true)
  })
})

describe('school rules are passed to batch generation', () => {
  it('an active rule is in the model request', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    await createPromptRule(ACCOUNT, { text: 'Piš kratší zadání.' })

    let schoolRules: string[] | undefined
    await generateForTopic(ACCOUNT, topicId, { ...DEFAULT_GENERATE_PARAMS, count: 2 }, {
      generate: async (request, options) => {
        schoolRules = request.schoolRules
        await options?.onBatch?.([question(1), question(2)], { model: 'google:gemini-flash-latest' })
        return { questions: [question(1), question(2)], rejected: [], chunks: 1, failedCalls: [], models: ['google:gemini-flash-latest'] }
      },
    })
    expect(schoolRules).toEqual(['Piš kratší zadání.'])
  })
})

describe('an excluded material is not used for generation', () => {
  it('loadTopicSource and the Claude Code file both skip an excluded material', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'pouzity.txt', text: TEXT })
    const skippedId = await seedMaterial(topicId, { fileName: 'vynechany.txt', text: TEXT })
    await db.update(materials).set({ excluded: true }).where(eq(materials.id, skippedId))

    const source = await loadTopicSource(ACCOUNT, topicId)
    expect(source?.text).not.toContain('vynechany.txt')
    expect(source?.text).toContain('pouzity.txt')
    expect(source?.sources).toBe(1)

    const file = await topicSourceFile(ACCOUNT, topicId)
    expect(file?.text).not.toContain('vynechany.txt')
  })

  it('usableCharCount ignores an excluded material', async () => {
    const { topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId, { text: TEXT })
    await db.update(materials).set({ excluded: true }).where(eq(materials.id, materialId))

    await recomputeTopicContent(ACCOUNT, topicId)
    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1)
    expect(topic!.usableCharCount).toBe(0)
    expect(topic!.lowContent).toBe(true)
  })
})
