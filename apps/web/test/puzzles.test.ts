import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { generatePuzzleWords } from '@testmaker/core/ai'
import { buildPuzzle, readCryptogram } from '@testmaker/core/puzzle'
import { db, grades, materials, puzzles, schools, subjects, testItems, topics } from '@/db'
import { GET as listPuzzles, POST as createPuzzle } from '@/app/api/puzzles/route'
import {
  DELETE as deletePuzzleRoute,
  GET as getPuzzleRoute,
  PUT as updatePuzzleRoute,
} from '@/app/api/puzzles/[id]/route'
import { GET as puzzlePdf } from '@/app/api/puzzles/[id]/pdf/route'
import { newId } from '@/lib/ids'
import { POST as createTest } from '@/app/api/tests/route'
import { POST as addToTest } from '@/app/api/puzzles/[id]/to-test/route'
import { loadTestItems } from '@/lib/tests'
import { insertPuzzle, loadRenderablePuzzle, suggestPuzzleWords } from '@/lib/puzzles'
import { jsonReq, req, seedMaterial, seedTemplate, seedTopic, seedAccount, ACCOUNT } from './helpers'

/** The material needs enough text, otherwise word extraction is refused before the model. */
const TEXT =
  'Rostlina se skládá z kořene, stonku, listů, květu a plodu. V listech probíhá fotosyntéza. '.repeat(
    6,
  )

const WORDSEARCH = {
  kind: 'wordsearch' as const,
  title: 'Části rostliny',
  instructions: '',
  entries: [
    { word: 'kořen', clue: 'Poutá rostlinu v půdě' },
    { word: 'stonek', clue: 'Nese listy a květy' },
    { word: 'list', clue: 'Probíhá v něm fotosyntéza' },
  ],
  payload: { cols: 10, rows: 10, seed: 'test', showClues: false },
}

/** Stubbed model: returns word + clue pairs, never a grid. */
const modelReturnsWords: typeof generatePuzzleWords = async () => ({
  entries: [
    { word: 'fotosyntéza', clue: 'Děj v zelených listech' },
    { word: 'chloroplast', clue: 'Zelené tělísko v buňce' },
  ],
  rejected: [],
  adjusted: [],
  models: ['google:gemini-flash-latest'],
  stats: { requested: 2, returned: 2, usable: 2, dropped: 0 },
})

/** Stubbed model that ran out of its daily quota. */
const modelFails: typeof generatePuzzleWords = async () => {
  throw new Error('You exceeded your current quota, please check your plan')
}

describe('puzzles in the library', () => {
  it('is saved, listed, and can be overwritten and deleted', async () => {
    const { topicId } = await seedTopic()

    const created = await createPuzzle(jsonReq('/api/puzzles', 'POST', { topicId, puzzle: WORDSEARCH }))
    expect(created.status).toBe(200)
    const { puzzle } = (await created.json()) as { puzzle: { id: string; title: string } }
    expect(puzzle.title).toBe('Části rostliny')

    const listed = await listPuzzles(req(`/api/puzzles?topicId=${topicId}`))
    const { puzzles: list } = (await listed.json()) as { puzzles: { id: string; entryCount: number }[] }
    expect(list.map((item) => item.id)).toContain(puzzle.id)
    expect(list[0]?.entryCount).toBe(3)

    const params = Promise.resolve({ id: puzzle.id })
    const updated = await updatePuzzleRoute(
      jsonReq(`/api/puzzles/${puzzle.id}`, 'PUT', {
        puzzle: { ...WORDSEARCH, title: 'Rostlina podruhé' },
      }),
      { params },
    )
    expect(updated.status).toBe(200)
    const [row] = await db.select().from(puzzles).where(eq(puzzles.id, puzzle.id))
    expect(row?.title).toBe('Rostlina podruhé')

    const deleted = await deletePuzzleRoute(req(`/api/puzzles/${puzzle.id}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: puzzle.id }),
    })
    expect(deleted.status).toBe(200)
    expect(await db.select().from(puzzles).where(eq(puzzles.id, puzzle.id))).toHaveLength(0)
  })

  it('an invalid puzzle is not saved and the reason is explained', async () => {
    const response = await createPuzzle(
      jsonReq('/api/puzzles', 'POST', {
        topicId: null,
        puzzle: { ...WORDSEARCH, entries: [{ word: 'list', clue: 'Zelený orgán' }] },
      }),
    )
    expect(response.status).toBe(400)
    const { error } = (await response.json()) as { error: string }
    // A sentence that tells what to fix — not a generic "invalid data".
    expect(error).toContain('aspoň 2')
    expect(error).not.toContain('Neplatná data')
  })

  it('a missing topic is refused with a message, not a foreign key failure', async () => {
    const response = await createPuzzle(
      jsonReq('/api/puzzles', 'POST', { topicId: 'neexistuje', puzzle: WORDSEARCH }),
    )
    expect(response.status).toBe(404)
    const { error } = (await response.json()) as { error: string }
    expect(error).toContain('téma se nenašlo')
  })

  it('a printable puzzle consists of a single item of kind puzzle', async () => {
    await seedTemplate()
    const { topicId } = await seedTopic()
    const saved = await insertPuzzle(ACCOUNT, 
      { ...WORDSEARCH, kind: 'cryptogram', payload: { phrase: 'les', seed: 'a' } },
      { topicId },
    )

    const renderable = await loadRenderablePuzzle(ACCOUNT, saved.id, { withKey: true })
    expect(renderable?.items).toHaveLength(1)
    expect(renderable?.items[0]?.kind).toBe('puzzle')
    // A puzzle is not graded — a points box or a grade has no place on the paper.
    expect(renderable?.test.graded).toBe(false)

    const puzzle = renderable?.items[0]?.puzzle
    expect(puzzle).toBeTruthy()
    const built = buildPuzzle(puzzle!)
    expect(built.kind).toBe('cryptogram')
    if (built.kind === 'cryptogram') expect(readCryptogram(built.cryptogram)).toBe('LES')
  })
})

describe('puzzle as the fifth test item kind', () => {
  it('is added to a test and carries a frozen snapshot', async () => {
    const templateId = await seedTemplate()
    const { topicId } = await seedTopic()
    const saved = await insertPuzzle(ACCOUNT, WORDSEARCH, { topicId })

    const response = await createTest(
      jsonReq('/api/tests', 'POST', {
        title: 'Písemka s hlavolamem',
        templateId,
        header: {},
        items: [{ kind: 'puzzle', puzzleId: saved.id }],
      }),
    )
    expect(response.status).toBe(200)
    const { id } = (await response.json()) as { id: string }

    const items = await loadTestItems(ACCOUNT, id)
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('puzzle')
    expect(items[0]?.puzzle?.title).toBe('Části rostliny')
    const [stored] = await db.select().from(testItems).where(eq(testItems.testId, id))
    expect(stored?.puzzleSnapshot).toBeTruthy()

    // Editing the puzzle in the library must not change a test it is already in.
    await db.update(puzzles).set({ title: 'Úplně jiný hlavolam' }).where(eq(puzzles.id, saved.id))
    const after = await loadTestItems(ACCOUNT, id)
    expect(after[0]?.puzzle?.title).toBe('Části rostliny')
  })
})

describe('adding a puzzle to an existing test', () => {
  it('is appended to the end of the test with a snapshot', async () => {
    const templateId = await seedTemplate()
    const { topicId } = await seedTopic()
    const saved = await insertPuzzle(ACCOUNT, WORDSEARCH, { topicId })

    const created = await createTest(
      jsonReq('/api/tests', 'POST', {
        title: 'Písemka na doplnění',
        templateId,
        header: {},
        items: [{ kind: 'heading', text: 'Část A' }],
      }),
    )
    const { id: testId } = (await created.json()) as { id: string }

    const response = await addToTest(jsonReq(`/api/puzzles/${saved.id}/to-test`, 'POST', { testId }), {
      params: Promise.resolve({ id: saved.id }),
    })
    expect(response.status).toBe(200)

    const items = await loadTestItems(ACCOUNT, testId)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'puzzle'])
    expect(items[1]?.puzzle?.title).toBe('Části rostliny')
    expect(items[1]?.puzzleSnapshot).toBeTruthy()
  })

  it('is not added to a missing test', async () => {
    const saved = await insertPuzzle(ACCOUNT, WORDSEARCH, { topicId: null })
    const response = await addToTest(
      jsonReq(`/api/puzzles/${saved.id}/to-test`, 'POST', { testId: 'neexistuje' }),
      { params: Promise.resolve({ id: saved.id }) },
    )
    expect(response.status).toBe(404)
  })
})

describe('words from the model', () => {
  it('the model supplies word and clue pairs', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const result = await suggestPuzzleWords(ACCOUNT, topicId, {
      kind: 'wordsearch',
      count: 2,
      generate: modelReturnsWords,
    })
    expect(result.entries.map((entry) => entry.word)).toEqual(['fotosyntéza', 'chloroplast'])
    expect(result.models).toEqual(['google:gemini-flash-latest'])
  })

  it('a topic without materials is refused before the model is called', async () => {
    const { topicId } = await seedTopic()
    await expect(
      suggestPuzzleWords(ACCOUNT, topicId, {
        kind: 'wordsearch',
        count: 5,
        generate: async () => {
          throw new Error('model se volat nesmí')
        },
      }),
    ).rejects.toThrow(/málo textu/)
  })

  it('a model error propagates to the caller so it can be translated', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    await expect(
      suggestPuzzleWords(ACCOUNT, topicId, { kind: 'cryptogram', count: 5, generate: modelFails }),
    ).rejects.toThrow(/quota/)
  })

  it('an excluded material does not make it into the puzzle source', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'pouzity.txt', text: TEXT })
    const skippedId = await seedMaterial(topicId, { fileName: 'vynechany.txt', text: TEXT })
    await db.update(materials).set({ excluded: true }).where(eq(materials.id, skippedId))

    let sentText = ''
    await suggestPuzzleWords(ACCOUNT, topicId, {
      kind: 'wordsearch',
      count: 2,
      generate: async (request) => {
        sentText = request.text
        return { entries: [], rejected: [], adjusted: [], models: [], stats: { requested: 2, returned: 0, usable: 0, dropped: 0 } }
      },
    })

    expect(sentText).toContain('pouzity.txt')
    expect(sentText).not.toContain('vynechany.txt')
  })
})

/** A topic in a different school — must not be visible from this school even by name. */
async function seedForeignTopic(): Promise<string> {
  const schoolId = 'skola-hlavolamu-jinde'
  await db.insert(schools).values({ id: schoolId, name: 'Jiná škola', slug: 'jinde' }).onConflictDoNothing()
  const subjectId = newId()
  const gradeId = newId()
  const topicId = newId()
  await db.insert(subjects).values({ id: subjectId, schoolId, name: 'Cizí předmět' })
  await db.insert(grades).values({ id: gradeId, schoolId, subjectId, name: '6. ročník' })
  await db.insert(topics).values({ id: topicId, schoolId, gradeId, name: 'Tajné cizí téma' })
  return topicId
}

describe('puzzle scope in the API', () => {
  it("a colleague's puzzle looks non-existent on every route", async () => {
    const templateId = await seedTemplate()
    const colleague = await seedAccount()
    const foreign = await insertPuzzle(colleague, WORDSEARCH, { topicId: null })
    const params = () => ({ params: Promise.resolve({ id: foreign.id }) })

    expect((await getPuzzleRoute(req(`/api/puzzles/${foreign.id}`), params())).status).toBe(404)
    expect(
      (await updatePuzzleRoute(jsonReq(`/api/puzzles/${foreign.id}`, 'PUT', { puzzle: WORDSEARCH }), params()))
        .status,
    ).toBe(404)
    expect(
      (await deletePuzzleRoute(req(`/api/puzzles/${foreign.id}`, { method: 'DELETE' }), params())).status,
    ).toBe(404)
    expect((await puzzlePdf(req(`/api/puzzles/${foreign.id}/pdf`), params())).status).toBe(404)

    const created = await createTest(
      jsonReq('/api/tests', 'POST', { title: 'Moje písemka', templateId, header: {}, items: [] }),
    )
    const { id: testId } = (await created.json()) as { id: string }
    expect(
      (await addToTest(jsonReq(`/api/puzzles/${foreign.id}/to-test`, 'POST', { testId }), params())).status,
    ).toBe(404)
    expect(await loadTestItems(ACCOUNT, testId)).toEqual([])

    // The colleague's puzzle stayed as it was.
    const [row] = await db.select().from(puzzles).where(eq(puzzles.id, foreign.id))
    expect(row?.title).toBe(WORDSEARCH.title)
  })

  it("another school's topic does not link to the puzzle and its name does not leak", async () => {
    const foreignTopic = await seedForeignTopic()

    const created = await createPuzzle(jsonReq('/api/puzzles', 'POST', { topicId: foreignTopic, puzzle: WORDSEARCH }))
    expect(created.status).toBe(404)

    const saved = await insertPuzzle(ACCOUNT, WORDSEARCH, { topicId: null })
    const updated = await updatePuzzleRoute(
      jsonReq(`/api/puzzles/${saved.id}`, 'PUT', { puzzle: WORDSEARCH, topicId: foreignTopic }),
      { params: Promise.resolve({ id: saved.id }) },
    )
    expect(updated.status).toBe(404)
    const [row] = await db.select().from(puzzles).where(eq(puzzles.id, saved.id))
    expect(row?.topicId).toBeNull()

    // Even if the link were created in the database another way, the list does not reveal the foreign topic name.
    await db.update(puzzles).set({ topicId: foreignTopic }).where(eq(puzzles.id, saved.id))
    const listed = await listPuzzles(req('/api/puzzles'))
    const { puzzles: list } = (await listed.json()) as { puzzles: { id: string; topicName: string | null }[] }
    expect(list.find((item) => item.id === saved.id)?.topicName).toBeNull()
  })
})

describe('a broken puzzle is neither printed nor added', () => {
  /** A word longer than the grid: it can be saved, not printed. */
  const BROKEN = {
    ...WORDSEARCH,
    entries: [
      { word: 'fotosyntéza', clue: 'Děj v zelených listech' },
      { word: 'list', clue: 'Zelený orgán' },
    ],
    payload: { cols: 6, rows: 6, seed: 'rozbita', showClues: false },
  }

  it('can be saved as a draft', async () => {
    const response = await createPuzzle(jsonReq('/api/puzzles', 'POST', { topicId: null, puzzle: BROKEN }))
    expect(response.status).toBe(200)
  })

  it('refuses both printing and adding with an explanation', async () => {
    const templateId = await seedTemplate()
    const saved = await insertPuzzle(ACCOUNT, BROKEN, { topicId: null })
    const params = () => ({ params: Promise.resolve({ id: saved.id }) })

    const pdf = await puzzlePdf(req(`/api/puzzles/${saved.id}/pdf`), params())
    expect(pdf.status).toBe(422)
    expect(await pdf.text()).toContain('nevejde')

    const created = await createTest(
      jsonReq('/api/tests', 'POST', { title: 'Cíl', templateId, header: {}, items: [] }),
    )
    const { id: testId } = (await created.json()) as { id: string }
    const response = await addToTest(jsonReq(`/api/puzzles/${saved.id}/to-test`, 'POST', { testId }), params())
    expect(response.status).toBe(422)
    const { error } = (await response.json()) as { error: string }
    expect(error).toContain('nevejde')
    expect(await loadTestItems(ACCOUNT, testId)).toEqual([])
  })
})
