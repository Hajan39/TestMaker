import { beforeEach, describe, expect, it } from 'vitest'
import { db, questionFeedback, questions, schools, users } from '@/db'
import { loadAiQuality } from '@/lib/aiQuality'
import { newId } from '@/lib/ids'
import { searchTextFor } from '@/lib/questions'
import { seedTopic, ACCOUNT } from './helpers'
import { TEST_SCHOOL_ID } from './setup'

const FOREIGN_SCHOOL = 'skola-jina-ai-kvalita'

/** A user of another school — for `created_by`, so inserting a question passes the foreign key. */
async function foreignAccount(): Promise<string> {
  await db.insert(schools).values({ id: FOREIGN_SCHOOL, name: 'Jiná škola', slug: 'jina-ai-kvalita' }).onConflictDoNothing()
  const id = newId()
  await db.insert(users).values({ id, schoolId: FOREIGN_SCHOOL, email: `${id}@jina.cz`, name: 'Cizí učitelka', role: 'spravce' })
  return id
}

/**
 * The "AI quality" overview in Management: how many questions each model generated
 * and how many teachers eventually regenerated, the most common reasons and the
 * subjects with the most regeneration. Tests build data directly via `db` because
 * they need to control the model and creation date, which `seedQuestion` does not offer.
 */

const DAY = 24 * 60 * 60 * 1000

/** A bank question with a specific model, source and creation date. */
async function seedAiQuestion(
  topicId: string | null,
  options: {
    model?: string | null
    source?: 'ai' | 'manual'
    createdAt?: string
    schoolId?: string
  } = {},
): Promise<string> {
  const id = newId()
  const payload = { prompt: 'Otázka', options: ['a', 'b'], correctIndex: 0 }
  const schoolId = options.schoolId ?? TEST_SCHOOL_ID
  await db.insert(questions).values({
    id,
    schoolId,
    createdBy: schoolId === TEST_SCHOOL_ID ? ACCOUNT.userId : await foreignAccount(),
    topicId,
    materialId: null,
    type: 'single_choice',
    payload,
    blocks: [],
    points: 1,
    difficulty: 2,
    source: options.source ?? 'ai',
    model: options.model ?? null,
    status: 'approved',
    createdAt: options.createdAt,
    searchText: searchTextFor({ payload }),
  })
  return id
}

/** A feedback row from a regeneration. */
async function seedFeedback(options: {
  questionId?: string | null
  model?: string | null
  reason?: 'nesmysl' | 'moznosti' | 'mimo' | 'tezka' | 'lehka' | 'cestina' | null
  createdAt?: string
  schoolId?: string
}): Promise<string> {
  const id = newId()
  await db.insert(questionFeedback).values({
    id,
    schoolId: options.schoolId ?? TEST_SCHOOL_ID,
    questionId: options.questionId ?? null,
    replacementId: null,
    model: options.model ?? null,
    reason: options.reason ?? null,
    note: null,
    createdBy: ACCOUNT.userId,
    createdAt: options.createdAt,
  })
  return id
}

beforeEach(async () => {
  await db.delete(questionFeedback)
  await db.delete(questions)
})

describe('loadAiQuality', () => {
  it('sums generated and regenerated questions per model', async () => {
    const { topicId } = await seedTopic()
    const q1 = await seedAiQuestion(topicId, { model: 'google:gemini-flash-latest' })
    await seedAiQuestion(topicId, { model: 'google:gemini-flash-latest' })
    await seedAiQuestion(topicId, { model: 'openai:gpt-5' })

    await seedFeedback({ questionId: q1, model: 'google:gemini-flash-latest', reason: 'tezka' })

    const overview = await loadAiQuality(ACCOUNT)
    const gemini = overview.models.find((row) => row.model === 'google:gemini-flash-latest')
    const gpt = overview.models.find((row) => row.model === 'openai:gpt-5')

    expect(gemini).toEqual({ model: 'google:gemini-flash-latest', generated: 2, regenerated: 1 })
    expect(gpt).toEqual({ model: 'openai:gpt-5', generated: 1, regenerated: 0 })
  })

  it('sums the most common regeneration reasons including regenerations without a reason', async () => {
    const { topicId } = await seedTopic()
    const q1 = await seedAiQuestion(topicId, { model: 'm' })
    const q2 = await seedAiQuestion(topicId, { model: 'm' })
    const q3 = await seedAiQuestion(topicId, { model: 'm' })

    await seedFeedback({ questionId: q1, model: 'm', reason: 'tezka' })
    await seedFeedback({ questionId: q2, model: 'm', reason: 'tezka' })
    await seedFeedback({ questionId: q3, model: 'm', reason: null })

    const overview = await loadAiQuality(ACCOUNT)
    expect(overview.reasons[0]).toEqual({ reason: 'tezka', count: 2 })
    expect(overview.reasons.find((row) => row.reason === null)).toEqual({ reason: null, count: 1 })
  })

  it('does not count questions and feedback of another school', async () => {
    const { topicId } = await seedTopic()
    await seedAiQuestion(topicId, { model: 'moje' })

    const foreign = await seedAiQuestion(null, { model: 'cizi', schoolId: FOREIGN_SCHOOL })
    await seedFeedback({ questionId: foreign, model: 'cizi', reason: 'tezka', schoolId: FOREIGN_SCHOOL })

    const overview = await loadAiQuality(ACCOUNT)
    expect(overview.models.find((row) => row.model === 'cizi')).toBeUndefined()
    expect(overview.reasons).toEqual([])
  })

  it('shows older questions without a model as the unknown model', async () => {
    const { topicId } = await seedTopic()
    const q = await seedAiQuestion(topicId, { model: null })
    await seedFeedback({ questionId: q, model: null, reason: null })

    const overview = await loadAiQuality(ACCOUNT)
    const unknownModel = overview.models.find((row) => row.model === 'neznámý model')
    expect(unknownModel).toEqual({ model: 'neznámý model', generated: 1, regenerated: 1 })
  })

  it('does not count questions outside the default 90-day window', async () => {
    const { topicId } = await seedTopic()
    const old = new Date(Date.now() - 120 * DAY).toISOString()
    await seedAiQuestion(topicId, { model: 'staré', createdAt: old })

    const overview = await loadAiQuality(ACCOUNT)
    expect(overview.models.find((row) => row.model === 'staré')).toBeUndefined()
  })

  it('keeps separate windows for generation and regeneration — a question outside the window regenerated inside gives generated: 0', async () => {
    const { topicId } = await seedTopic()
    const old = new Date(Date.now() - 120 * DAY).toISOString()
    const q = await seedAiQuestion(topicId, { model: 'stary-model', createdAt: old })
    // The feedback is created today (default `createdAt`), even though the question
    // was created long outside the window — each number counts by its own date.
    await seedFeedback({ questionId: q, model: 'stary-model', reason: 'tezka' })

    const overview = await loadAiQuality(ACCOUNT)
    expect(overview.models.find((row) => row.model === 'stary-model')).toEqual({
      model: 'stary-model',
      generated: 0,
      regenerated: 1,
    })
  })

  it('uses a custom period (`since`) instead of the default 90 days', async () => {
    const { topicId } = await seedTopic()
    const old = new Date(Date.now() - 120 * DAY).toISOString()
    await seedAiQuestion(topicId, { model: 'staré', createdAt: old })

    const overview = await loadAiQuality(ACCOUNT, { since: new Date(Date.now() - 200 * DAY).toISOString() })
    expect(overview.models.find((row) => row.model === 'staré')?.generated).toBe(1)
  })

  it('counts the subjects with the most regeneration and their most common reason', async () => {
    const biology = await seedTopic({ subject: 'Přírodopis' })
    const history = await seedTopic({ subject: 'Dějepis' })

    const p1 = await seedAiQuestion(biology.topicId, { model: 'm' })
    const p2 = await seedAiQuestion(biology.topicId, { model: 'm' })
    const d1 = await seedAiQuestion(history.topicId, { model: 'm' })

    await seedFeedback({ questionId: p1, model: 'm', reason: 'tezka' })
    await seedFeedback({ questionId: p2, model: 'm', reason: 'tezka' })
    await seedFeedback({ questionId: d1, model: 'm', reason: 'mimo' })

    const overview = await loadAiQuality(ACCOUNT)
    expect(overview.bySubject[0]).toEqual({ subject: 'Přírodopis', regenerated: 2, topReason: 'tezka' })
    expect(overview.bySubject[1]).toEqual({ subject: 'Dějepis', regenerated: 1, topReason: 'mimo' })
  })

  it('returns empty lists without feedback', async () => {
    const overview = await loadAiQuality(ACCOUNT)
    expect(overview.reasons).toEqual([])
    expect(overview.bySubject).toEqual([])
  })
})
