import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateQuestions, type GenerationRequest } from '@testmaker/core/ai'
import type { QuestionContent } from '@testmaker/core/schema'
import { db, questionFeedback, questions, schools, users } from '@/db'
import { convertQuestion } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { POST } from '@/app/api/questions/regenerate/route'
import { jsonReq, seedMaterial, seedQuestion, seedTopic, ACCOUNT } from './helpers'

/**
 * Converting a question to another type. The model is never called: the real
 * `generateQuestions` runs (checks, duplicate filter), only its model call is
 * faked — so the test also proves the original itself does not count as a
 * duplicate of its conversion.
 */

function withKey(): void {
  vi.stubEnv('AI_MODELS', 'google:gemini-flash-latest')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key')
}

const TEXT =
  'Výměna plynů probíhá v plicních sklípcích, kde kyslík přechází do krve a oxid uhličitý z krve ven. '.repeat(6)

/** The seeded original's fact (`seedQuestion`) asked as a short answer — same prompt, same answer. */
const CONVERTED: QuestionContent = {
  type: 'short_answer',
  payload: { prompt: 'Kde probíhá výměna plynů?', answer: 'V plicních sklípcích', acceptedAnswers: [] },
  blocks: [],
  points: 1,
  difficulty: 2,
}

/** Real generation with a fake model returning `CONVERTED`; remembers the request. */
function fakeModel(seen: GenerationRequest[]): typeof generateQuestions {
  return (request, options) => {
    seen.push(request)
    return generateQuestions(request, { ...options, callModel: async () => ({ questions: [CONVERTED] }) })
  }
}

async function otherSchoolTeacher(): Promise<string> {
  const schoolId = newId()
  await db.insert(schools).values({ id: schoolId, name: 'Jiná škola', slug: `jina-${schoolId}` })
  const userId = newId()
  await db.insert(users).values({ id: userId, schoolId, email: `${userId}@localhost`, name: 'Cizí učitelka', role: 'ucitelka' })
  return userId
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('converting a question to another type', () => {
  it('replaces the original with the target type, keeping its points and difficulty', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const other = await seedQuestion(topicId, { prompt: 'Co přechází z krve ven?' })
    const original = await seedQuestion(topicId)
    await db.update(questions).set({ points: 3, difficulty: 3 }).where(eq(questions.id, original))

    const seen: GenerationRequest[] = []
    const replacement = await convertQuestion(ACCOUNT, original, 'short_answer', { generate: fakeModel(seen) })

    expect(replacement.type).toBe('short_answer')
    expect(replacement.payload).toMatchObject({ answer: 'V plicních sklípcích' })
    expect(replacement.points).toBe(3)
    expect(replacement.difficulty).toBe(3)
    expect(replacement.source).toBe('ai')

    const [originalRow] = await db.select().from(questions).where(eq(questions.id, original))
    expect(originalRow!.status).toBe('rejected')
    const [otherRow] = await db.select().from(questions).where(eq(questions.id, other))
    expect(otherRow!.status).toBe('approved')

    const request = seen[0]!
    expect(request.types).toEqual(['short_answer'])
    expect(request.conversionOf).toEqual({
      originalType: 'single_choice',
      originalSummary: 'Kde probíhá výměna plynů? → V plicních sklípcích',
    })
    // The original is left out of the "avoid" list, the topic's other questions stay.
    expect(request.avoid).not.toContain('Kde probíhá výměna plynů? → V plicních sklípcích')
    expect(request.avoid).toContain('Co přechází z krve ven? → V plicních sklípcích')

    const feedback = await db.select().from(questionFeedback).where(eq(questionFeedback.questionId, original))
    expect(feedback).toHaveLength(1)
    expect(feedback[0]).toMatchObject({ replacementId: replacement.id, reason: null, note: 'converted to short_answer' })
  })

  it('refuses the same type and leaves the question untouched', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId)

    await expect(convertQuestion(ACCOUNT, original, 'single_choice', { generate: fakeModel([]) })).rejects.toThrow(
      /už tento typ má/,
    )
    const [row] = await db.select().from(questions).where(eq(questions.id, original))
    expect(row!.status).toBe('approved')
  })
})

describe('conversion API', () => {
  it('a question of another school is 404', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId)
    vi.stubEnv('E2E_UZIVATEL', await otherSchoolTeacher())

    const response = await POST(jsonReq('/api/questions/regenerate', 'POST', { id: original, targetType: 'open' }))
    expect(response.status).toBe(404)
  })

  it('a type the model cannot produce is 400', async () => {
    withKey()
    const { topicId } = await seedTopic()
    const original = await seedQuestion(topicId)

    const response = await POST(jsonReq('/api/questions/regenerate', 'POST', { id: original, targetType: 'label_image' }))
    expect(response.status).toBe(400)
  })

  it('the question’s own type is 400 with a message', async () => {
    withKey()
    const { topicId } = await seedTopic()
    const original = await seedQuestion(topicId)

    const response = await POST(
      jsonReq('/api/questions/regenerate', 'POST', { id: original, targetType: 'single_choice' }),
    )
    expect(response.status).toBe(400)
    const data = (await response.json()) as { error?: string }
    expect(data.error).toMatch(/už tento typ má/)
    const [row] = await db.select().from(questions).where(eq(questions.id, original))
    expect(row!.status).toBe('approved')
  })
})
