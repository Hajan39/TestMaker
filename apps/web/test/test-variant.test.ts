import { eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseQuestionSnapshot, type QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'
import { db, puzzles, questions, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import { loadTest, loadTestItems } from '@/lib/tests'
import { createTestVariant } from '@/lib/testVariant'
import { POST } from '@/app/api/tests/variant/route'
import { jsonReq, seedMaterial, seedQuestion, seedTemplate, seedTopic, seedUcet, UCET } from './helpers'

/**
 * Lehčí/těžší verze celé písemky: kopie testu, ve které se každá otázková
 * položka nahradí verzí kořenové otázky, jinak zůstane beze změny.
 */

const emptyHeader = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

/** Text materiálu musí být dost dlouhý, aby ho generování nezamítlo pro nedostatek obsahu. */
const TEXT =
  'Koloběh vody v přírodě zahrnuje výpar, vznik oblaků, srážky a odtok vody zpět do moří a oceánů. '.repeat(6)

/** Hlavolam jen kvůli cizímu klíči `test_items.puzzle_id` — obsah se nikde nečte. */
async function seedPuzzle(): Promise<string> {
  const id = newId()
  await db.insert(puzzles).values({
    id,
    schoolId: UCET.schoolId,
    ownerId: UCET.userId,
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

const VERZE: QuestionContent = {
  type: 'single_choice',
  payload: { prompt: 'Nová verze otázky', options: ['a', 'b'], correctIndex: 0 },
  blocks: [],
  points: 1,
  difficulty: 2,
}

/** Podvržený poskytovatel: model vždy vrátí přesně tuhle jednu otázku. */
const modelVrati: typeof generateQuestions = async () => ({
  questions: [VERZE],
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
    schoolId: UCET.schoolId,
    ownerId: overrides.ownerId ?? UCET.userId,
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
        schoolId: UCET.schoolId,
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
  it('použije existující verzi kořene a chybějící dogeneruje', async () => {
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

    const outcome = await createTestVariant(UCET, testId, 'easier', { generate: modelVrati })
    expect(outcome.replaced).toBe(1)
    expect(outcome.generated).toBe(1)
    expect(outcome.kept).toBe(0)
    expect(outcome.testId).not.toBe(testId)

    const newItems = await loadTestItems(UCET, outcome.testId)
    expect(newItems.map((item) => item.questionId)).toEqual([existingVariant, expect.any(String)])
    expect(newItems[1]?.questionId).not.toBe(needsGeneration)

    // Snímek nahrazené položky patří nové otázce, ne té původní — jinak by
    // se v hotové písemce vytisklo staré zadání se zaměněným id pod ním.
    const snapshot = parseQuestionSnapshot(newItems[0]?.questionSnapshot)
    expect(snapshot?.payload).toMatchObject({ prompt: 'Už existující lehčí verze' })
    expect((snapshot?.payload as { prompt?: string }).prompt).not.toBe('Otázka s hotovou verzí')

    // Originál zůstává nedotčený.
    const puvodniItems = await loadTestItems(UCET, testId)
    expect(puvodniItems.map((item) => item.questionId)).toEqual([original, needsGeneration])
  })

  it('test s lehčí verzí (d1), obrácený na těžší, použije kořen (d2) a model se nevolá', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const root = await seedQuestion(topicId, { prompt: 'Kořenová otázka (d2)' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, root))
    const lehci = await seedQuestion(topicId, { prompt: 'Lehčí verze kořene (d1)' })
    await db.update(questions).set({ difficulty: 1, variantOf: root }).where(eq(questions.id, lehci))

    // Test drží lehčí verzi (d1), ne kořen — zpřísnění na těžší se tedy má
    // vrátit ke kořeni (d2), aniž by se kdy sáhlo na model.
    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: lehci }])
    const generate = vi.fn(modelVrati)

    const outcome = await createTestVariant(UCET, testId, 'harder', { generate })
    expect(outcome).toMatchObject({ replaced: 1, generated: 0, kept: 0 })
    expect(generate).not.toHaveBeenCalled()

    const [item] = await loadTestItems(UCET, outcome.testId)
    expect(item?.questionId).toBe(root)
  })

  it('verze, která už v kopii je, se nepoužije podruhé — vygeneruje se nová', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const root = await seedQuestion(topicId, { prompt: 'Kořen (d2)' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, root))
    const lehci = await seedQuestion(topicId, { prompt: 'Lehčí verze kořene (d1)' })
    await db.update(questions).set({ difficulty: 1, variantOf: root }).where(eq(questions.id, lehci))

    // V písemce je kořen i jeho lehčí verze. Jediný kandidát na zlehčení
    // kořene je právě ta lehčí verze — jenže ta v kopii už stojí, takže by
    // na papíře byla dvakrát. Místo ní se musí vygenerovat nová.
    const testId = await seedTest(gradeId, templateId, [
      { kind: 'question', questionId: root },
      { kind: 'question', questionId: lehci },
    ])
    const generate = vi.fn(modelVrati)

    const outcome = await createTestVariant(UCET, testId, 'easier', { generate })
    expect(outcome).toMatchObject({ replaced: 0, generated: 1, kept: 1 })
    expect(generate).toHaveBeenCalledTimes(1)

    const ids = (await loadTestItems(UCET, outcome.testId)).map((item) => item.questionId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).not.toBe(lehci)
    expect(ids[1]).toBe(lehci)
  })

  it('na hranici obtížnosti ponechá původní otázku', async () => {
    const { topicId, gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const nejlehci = await seedQuestion(topicId, { prompt: 'Otázka na hranici' })
    await db.update(questions).set({ difficulty: 1 }).where(eq(questions.id, nejlehci))

    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: nejlehci }])
    const outcome = await createTestVariant(UCET, testId, 'easier', { generate: modelVrati })

    expect(outcome.kept).toBe(1)
    expect(outcome.replaced).toBe(0)
    expect(outcome.generated).toBe(0)
    const [item] = await loadTestItems(UCET, outcome.testId)
    expect(item?.questionId).toBe(nejlehci)
  })

  it('hlavolam a položka bez otázky zůstanou beze změny', async () => {
    const { gradeId } = await seedTopic()
    const templateId = await seedTemplate()

    const puzzleId = await seedPuzzle()
    const testId = await seedTest(gradeId, templateId, [
      { kind: 'heading' },
      { kind: 'puzzle', puzzleId },
      { kind: 'question', questionId: null },
    ])
    const outcome = await createTestVariant(UCET, testId, 'harder', { generate: modelVrati })

    expect(outcome.replaced).toBe(0)
    expect(outcome.generated).toBe(0)
    expect(outcome.kept).toBe(0)

    const newItems = await loadTestItems(UCET, outcome.testId)
    expect(newItems.map((item) => item.kind)).toEqual(['heading', 'puzzle', 'question'])
    expect(newItems[1]?.puzzleId).toBe(puzzleId)
    expect(newItems[2]?.questionId).toBeNull()
  })

  it('položka s questionId na natvrdo smazanou otázku zůstane beze změny', async () => {
    const { topicId, gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka, co zmizí z banky' })
    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId }])
    // `test_items.question_id → questions.id` je `on delete set null`: běžné
    // smazání by položku samo odpojilo. Aby test opravdu ověřil větev kódu,
    // co se stará o zaniklý odkaz (`questionId` je vyplněné, ale řádek v
    // bance chybí), smaže se otázka bez spuštění cizího klíče — vypnuté jen
    // na dobu tohoto testu, `finally` ho vrátí zpátky, i kdyby test spadl.
    await db.run(sql`pragma foreign_keys=off`)
    try {
      await db.delete(questions).where(eq(questions.id, questionId))
      const [raw] = await db.select().from(testItems).where(eq(testItems.testId, testId))
      expect(raw?.questionId, 'předpoklad testu: odkaz zůstal nevyčištěný').toBe(questionId)

      const outcome = await createTestVariant(UCET, testId, 'harder', { generate: modelVrati })
      expect(outcome).toMatchObject({ replaced: 0, generated: 0, kept: 0 })

      const [item] = await loadTestItems(UCET, outcome.testId)
      expect(item?.questionId).toBe(questionId)
    } finally {
      await db.run(sql`pragma foreign_keys=on`)
    }
  })

  it('zamítnutá (rejected) verze se nepoužije, vygeneruje se nová', async () => {
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
    const outcome = await createTestVariant(UCET, testId, 'harder', { generate: modelVrati })

    expect(outcome.generated).toBe(1)
    expect(outcome.replaced).toBe(0)
    const [item] = await loadTestItems(UCET, outcome.testId)
    expect(item?.questionId).not.toBe(rejectedVariant)
  })

  it('selhání modelu u jedné otázky ji ponechá a pokračuje se dál', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const selze = await seedQuestion(topicId, { prompt: 'Otázka, u které model selže' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, selze))
    const povede = await seedQuestion(topicId, { prompt: 'Otázka, která se povede' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, povede))

    const testId = await seedTest(gradeId, templateId, [
      { kind: 'question', questionId: selze },
      { kind: 'question', questionId: povede },
    ])

    let volani = 0
    const outcome = await createTestVariant(UCET, testId, 'harder', {
      generate: async (request, options) => {
        volani += 1
        if (volani === 1) throw new Error('Model selhal')
        return modelVrati(request, options)
      },
    })

    expect(outcome.kept).toBe(1)
    expect(outcome.generated).toBe(1)
    const newItems = await loadTestItems(UCET, outcome.testId)
    expect(newItems[0]?.questionId).toBe(selze)
    expect(newItems[1]?.questionId).not.toBe(povede)
  })

  it('nová písemka má gradeId zdroje a název s en dash podle směru', async () => {
    const { topicId, gradeId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const templateId = await seedTemplate()
    const question = await seedQuestion(topicId, { prompt: 'Otázka' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, question))
    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: question }], {
      title: 'Půlletní písemka',
    })

    const easier = await createTestVariant(UCET, testId, 'easier', { generate: modelVrati })
    expect((await loadTest(UCET, easier.testId))?.gradeId).toBe(gradeId)
    expect((await loadTest(UCET, easier.testId))?.title).toBe('Půlletní písemka – lehčí')

    const harder = await createTestVariant(UCET, testId, 'harder', { generate: modelVrati })
    expect((await loadTest(UCET, harder.testId))?.title).toBe('Půlletní písemka – těžší')
  })

  it('test bez otázkových položek vytvoří prázdnou kopii se všemi počty na nule', async () => {
    const { gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const testId = await seedTest(gradeId, templateId, [])

    const outcome = await createTestVariant(UCET, testId, 'easier', { generate: modelVrati })
    expect(outcome).toMatchObject({ replaced: 0, generated: 0, kept: 0 })
    expect(await loadTestItems(UCET, outcome.testId)).toEqual([])
  })

  it('cizí test se nedá verzovat', async () => {
    const kolegyne = await seedUcet()
    const { topicId, gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const question = await seedQuestion(topicId, { prompt: 'Otázka cizího testu' })
    const testId = await seedTest(gradeId, templateId, [{ kind: 'question', questionId: question }], {
      ownerId: kolegyne.userId,
      visibility: 'soukrome',
    })

    await expect(createTestVariant(UCET, testId, 'easier', { generate: modelVrati })).rejects.toThrow(
      /nenašel/,
    )
  })
})

describe('API verze písemky', () => {
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

  it('cizí test vrátí 404 ještě před streamem', async () => {
    withKey()
    const kolegyne = await seedUcet()
    const { gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const testId = await seedTest(gradeId, templateId, [], { ownerId: kolegyne.userId })

    const response = await POST(jsonReq('/api/tests/variant', 'POST', { testId, direction: 'easier' }))
    expect(response.status).toBe(404)
  })

  it('náhled písemku verzovat nesmí — 403', async () => {
    withKey()
    const { gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    const testId = await seedTest(gradeId, templateId, [])
    vi.stubEnv('E2E_UZIVATEL', (await seedUcet({ role: 'nahled' })).userId)

    const response = await POST(jsonReq('/api/tests/variant', 'POST', { testId, direction: 'easier' }))
    expect(response.status).toBe(403)
  })

  it('projde stream se start/progress/done', async () => {
    withKey()
    const { topicId, gradeId } = await seedTopic()
    const templateId = await seedTemplate()
    // Existující verze je po ruce, aby stream neskončil u skutečného modelu —
    // API testy volání modelu nikdy nespouštějí (viz `generate-api.test.ts`).
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
    // Id kopie jde už ve `start` — kdyby stream skončil předčasně, klient
    // kopii i tak najde. V `done` je totéž id.
    expect(events[0]).toMatchObject({ type: 'start', total: 1, testId: expect.any(String) })
    expect(events[0]!.testId).not.toBe(testId)
    expect(events.at(-1)).toMatchObject({ type: 'done', replaced: 1, generated: 0, kept: 0 })
    expect(events.at(-1)!.testId).toBe(events[0]!.testId)
  })
})
