import { eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseQuestionSnapshot, type QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'
import { db, puzzles, questions, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import { loadTest, loadTestItems } from '@/lib/tests'
import { createTestVariant } from '@/lib/testVariant'
import { POST } from '@/app/api/tests/variant/route'
import { jsonReq, seedMaterial, seedQuestion, seedTemplate, seedTopic, seedAccount, ACCOUNT } from './helpers'

/**
 * Easier/harder version of a whole test: a copy of the test in which every
 * question item is replaced by a variant of the root question, otherwise unchanged.
 */

const emptyHeader = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

/** The material text must be long enough so generation does not reject it for lack of content. */
const TEXT =
  'Koloběh vody v přírodě zahrnuje výpar, vznik oblaků, srážky a odtok vody zpět do moří a oceánů. '.repeat(6)

/** A puzzle only for the `test_items.puzzle_id` foreign key — its content is never read. */
async function seedPuzzle(): Promise<string> {
  const id = newId()
  await db.insert(puzzles).values({
    id,
    schoolId: ACCOUNT.schoolId,
    ownerId: ACCOUNT.userId,
    topicId: null,
    kind: 'wordsearch',
    title: 'Zkušební hlavolam',
    instructions: '',
    entries: [
      { word: 'VODA', clue: 'Kapalina koloběhu' },
      { word: 'PARA', clue: 'Plynné skupenství vody' },
    ],
    payload: { cols: 10, rows: 10, seed: 'test', showClues: false },
  })
  return id
}

const VERSION: QuestionContent = {
  type: 'single_choice',
  payload: { prompt: 'Nová verze otázky', options: ['a', 'b'], correctIndex: 0 },
  blocks: [],
  points: 1,
  difficulty: 2,
}

/** Fake provider: the model always returns exactly this one question. */
const modelReturns: typeof generateQuestions = async () => ({
  questions: [VERSION],
  rejected: [],
  chunks: 1,
  failedCalls: [],
  models: ['google:gemini-flash-latest'],
})

async function seedTest(
  gradeId: string | null,
  templateId: string,
  items: { kind: 'question' | 'heading' | 'puzzle'; questionId?: string | null; puzzleId?: string | null }[],
  overrides: { title?: string; ownerId?: string; visibility?: 'soukrome' | 'skola' } = {},
): Promise<string> {
  const id = newId()
  await db.insert(tests).values({
    id,
    schoolId: ACCOUNT.schoolId,
    ownerId: overrides.ownerId ?? ACCOUNT.userId,
    visibility: overrides.visibility ?? 'soukrome',
    title: overrides.title ?? 'Písemka o koloběhu vody',
    templateId,
    gradeId,
    header: emptyHeader,
  })
  if (items.length > 0) {
    await db.insert(testItems).values(
      items.map((item, index) => ({
        id: newId(),
        schoolId: ACCOUNT.schoolId,
        testId: id,
        position: index,
        kind: item.kind,
        questionId: item.questionId ?? null,
        puzzleId: item.puzzleId ?? null,
        text: item.kind === 'heading' ? 'Nadpis' : null,
      })),
    )
  }
  return id
}

describe('createTestVariant', () => {
  it('uses an existing variant of the root and generates the missing ones', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const original = await seedQuestion(topicId, { prompt: 'Otázka s hotovou verzí' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))
    const existingVariant = await seedQuestion(topicId, { prompt: 'Už existující lehčí verze' })
    await db
      .update(questions)
      .set({ difficulty: 1, variantOf: original })
      .where(eq(questions.id, existingVariant))

    const needsGeneration = await seedQuestion(topicId, { prompt: 'Otázka bez hotové verze' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, needsGeneration))

    const testId = await seedTest(gradeId, templateId, [
      { kind: 'question', questionId: original },
      { kind: 'question', questionId: needsGeneration },
    ])

    const outcome = await createTestVariant(ACCOUNT, testId, 'easier', { generate: modelReturns })
    expect(outcome.replaced).toBe(1)
    expect(outcome.generated).toBe(1)
    expect(outcome.kept).toBe(0)
    expect(outcome.testId).not.toBe(testId)

    const newItems = await loadTestItems(ACCOUNT, outcome.testId)
    expect(newItems.map((item) => item.questionId)).toEqual([existingVariant, expect.any(String)])
    expect(newItems[1]?.questionId).not.toBe(needsGeneration)

    // The snapshot of the replaced item belongs to the new question, not the original —
    // otherwise the finished test would print the old prompt with a swapped id beneath it.
    const snapshot = parseQuestionSnapshot(newItems[0]?.questionSnapshot)
    expect(snapshot?.payload).toMatchObject({ prompt: 'Už existující lehčí verze' })
    expect((snapshot?.payload as { prompt?: string }).prompt).not.toBe('Otázka s hotovou verzí')

    // The original stays untouched.
    const originalItems = await loadTestItems(ACCOUNT, testId)
    expect(originalItems.map((item) => item.questionId)).toEqual([original, needsGeneration])
  })

  it('a test holding an easier variant (d1), turned harder, uses the root (d2) without calling the model', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const root = await seedQuestion(topicId, { prompt: 'Kořenová otázka (d2)' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, root))
    const easier = await seedQuestion(topicId, { prompt: 'Lehčí verze kořene (d1)' })
    await db.update(questions).set({ difficulty: 1, variantOf: root }).where(eq(questions.id, easier))

    // The test holds the easier variant (d1), not the root — making it harder should
    // therefore go back to the root (d2) without ever touching the model.
    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: easier }])
    const generate = vi.fn(modelReturns)

    const outcome = await createTestVariant(ACCOUNT, testId, 'harder', { generate })
    expect(outcome).toMatchObject({ replaced: 1, generated: 0, kept: 0 })
    expect(generate).not.toHaveBeenCalled()

    const [item] = await loadTestItems(ACCOUNT, outcome.testId)
    expect(item?.questionId).toBe(root)
  })

  it('a variant already in the copy is not used twice — a new one is generated', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const root = await seedQuestion(topicId, { prompt: 'Kořen (d2)' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, root))
    const easier = await seedQuestion(topicId, { prompt: 'Lehčí verze kořene (d1)' })
    await db.update(questions).set({ difficulty: 1, variantOf: root }).where(eq(questions.id, easier))

    // The test holds the root and its easier variant. The only candidate for making
    // the root easier is that very variant — but it is already in the copy, so it
    // would be on paper twice. A new one must be generated instead.
    const testId = await seedTest(gradeId, templateId, [
      { kind: 'question', questionId: root },
      { kind: 'question', questionId: easier },
    ])
    const generate = vi.fn(modelReturns)

    const outcome = await createTestVariant(ACCOUNT, testId, 'easier', { generate })
    expect(outcome).toMatchObject({ replaced: 0, generated: 1, kept: 1 })
    expect(generate).toHaveBeenCalledTimes(1)

    const ids = (await loadTestItems(ACCOUNT, outcome.testId)).map((item) => item.questionId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).not.toBe(easier)
    expect(ids[1]).toBe(easier)
  })

  it('keeps the original question at the difficulty boundary', async () => {
    const { topicId, gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const easiest = await seedQuestion(topicId, { prompt: 'Otázka na hranici' })
    await db.update(questions).set({ difficulty: 1 }).where(eq(questions.id, easiest))

    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: easiest }])
    const outcome = await createTestVariant(ACCOUNT, testId, 'easier', { generate: modelReturns })

    expect(outcome.kept).toBe(1)
    expect(outcome.replaced).toBe(0)
    expect(outcome.generated).toBe(0)
    const [item] = await loadTestItems(ACCOUNT, outcome.testId)
    expect(item?.questionId).toBe(easiest)
  })

  it('a puzzle and an item without a question stay unchanged', async () => {
    const { gradeId } = await seedTopic()
    const templateId = await seedTemplate()

    const puzzleId = await seedPuzzle()
    const testId = await seedTest(gradeId, templateId, [
      { kind: 'heading' },
      { kind: 'puzzle', puzzleId },
      { kind: 'question', questionId: null },
    ])
    const outcome = await createTestVariant(ACCOUNT, testId, 'harder', { generate: modelReturns })

    expect(outcome.replaced).toBe(0)
    expect(outcome.generated).toBe(0)
    expect(outcome.kept).toBe(0)

    const newItems = await loadTestItems(ACCOUNT, outcome.testId)
    expect(newItems.map((item) => item.kind)).toEqual(['heading', 'puzzle', 'question'])
    expect(newItems[1]?.puzzleId).toBe(puzzleId)
    expect(newItems[2]?.questionId).toBeNull()
  })

  it('an item whose questionId points to a hard-deleted question stays unchanged', async () => {
    const { topicId, gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka, co zmizí z banky' })
    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId }])
    // `test_items.question_id → questions.id` is `on delete set null`: a normal
    // delete would unlink the item by itself. So that the test really covers the
    // code branch handling a dangling reference (`questionId` set, but the row is
    // missing from the bank), the question is deleted with the foreign key off —
    // only for this test; `finally` turns it back on even if the test fails.
    await db.run(sql`pragma foreign_keys=off`)
    try {
      await db.delete(questions).where(eq(questions.id, questionId))
      const [raw] = await db.select().from(testItems).where(eq(testItems.testId, testId))
      expect(raw?.questionId, 'test precondition: the reference stayed uncleared').toBe(questionId)

      const outcome = await createTestVariant(ACCOUNT, testId, 'harder', { generate: modelReturns })
      expect(outcome).toMatchObject({ replaced: 0, generated: 0, kept: 0 })

      const [item] = await loadTestItems(ACCOUNT, outcome.testId)
      expect(item?.questionId).toBe(questionId)
    } finally {
      await db.run(sql`pragma foreign_keys=on`)
    }
  })

  it('a rejected variant is not used, a new one is generated', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const original = await seedQuestion(topicId, { prompt: 'Otázka se zamítnutou verzí' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))
    const rejectedVariant = await seedQuestion(topicId, { prompt: 'Zamítnutá verze', status: 'rejected' })
    await db
      .update(questions)
      .set({ difficulty: 3, variantOf: original })
      .where(eq(questions.id, rejectedVariant))

    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: original }])
    const outcome = await createTestVariant(ACCOUNT, testId, 'harder', { generate: modelReturns })

    expect(outcome.generated).toBe(1)
    expect(outcome.replaced).toBe(0)
    const [item] = await loadTestItems(ACCOUNT, outcome.testId)
    expect(item?.questionId).not.toBe(rejectedVariant)
  })

  it('a model failure on one question keeps it and carries on', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const fails = await seedQuestion(topicId, { prompt: 'Otázka, u které model selže' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, fails))
    const succeeds = await seedQuestion(topicId, { prompt: 'Otázka, která se povede' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, succeeds))

    const testId = await seedTest(gradeId, templateId, [
      { kind: 'question', questionId: fails },
      { kind: 'question', questionId: succeeds },
    ])

    let calls = 0
    const outcome = await createTestVariant(ACCOUNT, testId, 'harder', {
      generate: async (request, options) => {
        calls += 1
        if (calls === 1) throw new Error('Model selhal')
        return modelReturns(request, options)
      },
    })

    expect(outcome.kept).toBe(1)
    expect(outcome.generated).toBe(1)
    const newItems = await loadTestItems(ACCOUNT, outcome.testId)
    expect(newItems[0]?.questionId).toBe(fails)
    expect(newItems[1]?.questionId).not.toBe(succeeds)
  })

  it('the new test has the source gradeId and a title with an en dash per direction', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const question = await seedQuestion(topicId, { prompt: 'Otázka' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, question))
    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: question }], {
      title: 'Půlletní písemka',
    })

    const easier = await createTestVariant(ACCOUNT, testId, 'easier', { generate: modelReturns })
    expect((await loadTest(ACCOUNT, easier.testId))?.gradeId).toBe(gradeId)
    expect((await loadTest(ACCOUNT, easier.testId))?.title).toBe('Půlletní písemka – lehčí')

    const harder = await createTestVariant(ACCOUNT, testId, 'harder', { generate: modelReturns })
    expect((await loadTest(ACCOUNT, harder.testId))?.title).toBe('Půlletní písemka – těžší')
  })

  it('a test without question items creates an empty copy with all counts at zero', async () => {
    const { gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const testId = await seedTest(gradeId, templateId, [])

    const outcome = await createTestVariant(ACCOUNT, testId, 'easier', { generate: modelReturns })
    expect(outcome).toMatchObject({ replaced: 0, generated: 0, kept: 0 })
    expect(await loadTestItems(ACCOUNT, outcome.testId)).toEqual([])
  })

  it('a foreign test cannot be versioned', async () => {
    const colleague = await seedAccount()
    const { topicId, gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const question = await seedQuestion(topicId, { prompt: 'Otázka cizího testu' })
    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: question }], {
      ownerId: colleague.userId,
      visibility: 'soukrome',
    })

    await expect(createTestVariant(ACCOUNT, testId, 'easier', { generate: modelReturns })).rejects.toThrow(
      /nenašel/,
    )
  })
})

describe('test variant API', () => {
  function withKey(): void {
    vi.stubEnv('AI_MODELS', 'google:gemini-flash-latest')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key')
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function readEvents(response: Response): Promise<Record<string, unknown>[]> {
    const text = await response.text()
    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  it('a foreign test returns 404 before the stream starts', async () => {
    withKey()
    const colleague = await seedAccount()
    const { gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const testId = await seedTest(gradeId, templateId, [], { ownerId: colleague.userId })

    const response = await POST(jsonReq('/api/tests/variant', 'POST', { testId, direction: 'easier' }))
    expect(response.status).toBe(404)
  })

  it('preview role must not version a test — 403', async () => {
    withKey()
    const { gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const testId = await seedTest(gradeId, templateId, [])
    vi.stubEnv('E2E_UZIVATEL', (await seedAccount({ role: 'nahled' })).userId)

    const response = await POST(jsonReq('/api/tests/variant', 'POST', { testId, direction: 'easier' }))
    expect(response.status).toBe(403)
  })

  it('projde stream se start/progress/done', async () => {
    withKey()
    const { topicId, gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    // An existing variant is at hand so the stream does not end up at the real model —
    // API tests never trigger model calls (see `generate-api.test.ts`).
    const question = await seedQuestion(topicId, { prompt: 'Otázka pro stream' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, question))
    const existingVariant = await seedQuestion(topicId, { prompt: 'Hotová těžší verze' })
    await db
      .update(questions)
      .set({ difficulty: 3, variantOf: question })
      .where(eq(questions.id, existingVariant))
    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: question }])

    const response = await POST(jsonReq('/api/tests/variant', 'POST', { testId, direction: 'harder' }))
    expect(response.status).toBe(200)
    const events = await readEvents(response)
    // The copy id is already sent in `start` — if the stream ended early, the client
    // still finds the copy. `done` carries the same id.
    expect(events[0]).toMatchObject({ type: 'start', total: 1, testId: expect.any(String) })
    expect(events[0]!.testId).not.toBe(testId)
    expect(events.at(-1)).toMatchObject({ type: 'done', replaced: 1, generated: 0, kept: 0 })
    expect(events.at(-1)!.testId).toBe(events[0]!.testId)
  })
})
