import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { generatePuzzleWords } from '@testmaker/core/ai'
import { buildPuzzle, readCryptogram } from '@testmaker/core/puzzle'
import { db, materials, puzzles, testItems } from '@/db'
import { GET as listPuzzles, POST as createPuzzle } from '@/app/api/puzzles/route'
import { DELETE as deletePuzzleRoute, PUT as updatePuzzleRoute } from '@/app/api/puzzles/[id]/route'
import { POST as createTest } from '@/app/api/tests/route'
import { POST as addToTest } from '@/app/api/puzzles/[id]/to-test/route'
import { loadTestItems } from '@/lib/tests'
import { insertPuzzle, loadRenderablePuzzle, suggestPuzzleWords } from '@/lib/puzzles'
import { jsonReq, req, seedMaterial, seedTemplate, seedTopic, UCET } from './helpers'

/** Materiál musí mít dost textu, jinak se vytažení slov odmítne ještě před modelem. */
const TEXT =
  'Rostlina se skládá z kořene, stonku, listů, květu a plodu. V listech probíhá fotosyntéza. '.repeat(
    6,
  )

const OSMISMERKA = {
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

/** Podvržený model: vrátí dvojice slovo + nápověda, nikdy mřížku. */
const modelVratiSlova: typeof generatePuzzleWords = async () => ({
  entries: [
    { word: 'fotosyntéza', clue: 'Děj v zelených listech' },
    { word: 'chloroplast', clue: 'Zelené tělísko v buňce' },
  ],
  rejected: [],
  adjusted: [],
  models: ['google:gemini-flash-latest'],
  stats: { requested: 2, returned: 2, usable: 2, dropped: 0 },
})

/** Podvržený model, kterému došel denní limit. */
const modelSelze: typeof generatePuzzleWords = async () => {
  throw new Error('You exceeded your current quota, please check your plan')
}

describe('hlavolamy v knihovně', () => {
  it('uloží se, najde v seznamu a dá se přepsat i smazat', async () => {
    const { topicId } = await seedTopic()

    const created = await createPuzzle(jsonReq('/api/puzzles', 'POST', { topicId, puzzle: OSMISMERKA }))
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
        puzzle: { ...OSMISMERKA, title: 'Rostlina podruhé' },
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

  it('neplatný hlavolam se neuloží a vysvětlí se to', async () => {
    const response = await createPuzzle(
      jsonReq('/api/puzzles', 'POST', {
        topicId: null,
        puzzle: { ...OSMISMERKA, entries: [{ word: 'list', clue: 'Zelený orgán' }] },
      }),
    )
    expect(response.status).toBe(400)
    const { error } = (await response.json()) as { error: string }
    expect(error).toContain('Neplatná data')
  })

  it('hlavolam k tisku se skládá z jediné položky druhu puzzle', async () => {
    await seedTemplate()
    const { topicId } = await seedTopic()
    const saved = await insertPuzzle(UCET, 
      { ...OSMISMERKA, kind: 'cryptogram', payload: { phrase: 'les', seed: 'a' } },
      { topicId },
    )

    const renderable = await loadRenderablePuzzle(UCET, saved.id, { withKey: true })
    expect(renderable?.items).toHaveLength(1)
    expect(renderable?.items[0]?.kind).toBe('puzzle')
    // Hlavolam se neznámkuje — políčko na body a známku na papíře nemá co dělat.
    expect(renderable?.test.graded).toBe(false)

    const puzzle = renderable?.items[0]?.puzzle
    expect(puzzle).toBeTruthy()
    const built = buildPuzzle(puzzle!)
    expect(built.kind).toBe('cryptogram')
    if (built.kind === 'cryptogram') expect(readCryptogram(built.cryptogram)).toBe('LES')
  })
})

describe('hlavolam jako pátý druh položky testu', () => {
  it('zařadí se do písemky a nese si zmrazený snímek', async () => {
    const templateId = await seedTemplate()
    const { topicId } = await seedTopic()
    const saved = await insertPuzzle(UCET, OSMISMERKA, { topicId })

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

    const items = await loadTestItems(UCET, id)
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('puzzle')
    expect(items[0]?.puzzle?.title).toBe('Části rostliny')
    const [stored] = await db.select().from(testItems).where(eq(testItems.testId, id))
    expect(stored?.puzzleSnapshot).toBeTruthy()

    // Úprava hlavolamu v knihovně nesmí změnit už zařazenou písemku.
    await db.update(puzzles).set({ title: 'Úplně jiný hlavolam' }).where(eq(puzzles.id, saved.id))
    const after = await loadTestItems(UCET, id)
    expect(after[0]?.puzzle?.title).toBe('Části rostliny')
  })
})

describe('zařazení hlavolamu do hotové písemky', () => {
  it('přibude na konci písemky i se snímkem', async () => {
    const templateId = await seedTemplate()
    const { topicId } = await seedTopic()
    const saved = await insertPuzzle(UCET, OSMISMERKA, { topicId })

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

    const items = await loadTestItems(UCET, testId)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'puzzle'])
    expect(items[1]?.puzzle?.title).toBe('Části rostliny')
    expect(items[1]?.puzzleSnapshot).toBeTruthy()
  })

  it('do neexistující písemky se hlavolam nezařadí', async () => {
    const saved = await insertPuzzle(UCET, OSMISMERKA, { topicId: null })
    const response = await addToTest(
      jsonReq(`/api/puzzles/${saved.id}/to-test`, 'POST', { testId: 'neexistuje' }),
      { params: Promise.resolve({ id: saved.id }) },
    )
    expect(response.status).toBe(404)
  })
})

describe('slova od modelu', () => {
  it('model dodá dvojice slovo a nápověda', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const result = await suggestPuzzleWords(UCET, topicId, {
      kind: 'wordsearch',
      count: 2,
      generate: modelVratiSlova,
    })
    expect(result.entries.map((entry) => entry.word)).toEqual(['fotosyntéza', 'chloroplast'])
    expect(result.models).toEqual(['google:gemini-flash-latest'])
  })

  it('téma bez materiálů se odmítne dřív, než se model vůbec zavolá', async () => {
    const { topicId } = await seedTopic()
    await expect(
      suggestPuzzleWords(UCET, topicId, {
        kind: 'wordsearch',
        count: 5,
        generate: async () => {
          throw new Error('model se volat nesmí')
        },
      }),
    ).rejects.toThrow(/málo textu/)
  })

  it('chyba modelu propadne volajícímu, ať ji přeloží do češtiny', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    await expect(
      suggestPuzzleWords(UCET, topicId, { kind: 'cryptogram', count: 5, generate: modelSelze }),
    ).rejects.toThrow(/quota/)
  })

  it('vynechaný materiál se do zdroje pro hlavolam nedostane', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'pouzity.txt', text: TEXT })
    const vynechanyId = await seedMaterial(topicId, { fileName: 'vynechany.txt', text: TEXT })
    await db.update(materials).set({ excluded: true }).where(eq(materials.id, vynechanyId))

    let poslanyText = ''
    await suggestPuzzleWords(UCET, topicId, {
      kind: 'wordsearch',
      count: 2,
      generate: async (request) => {
        poslanyText = request.text
        return { entries: [], rejected: [], adjusted: [], models: [], stats: { requested: 2, returned: 0, usable: 0, dropped: 0 } }
      },
    })

    expect(poslanyText).toContain('pouzity.txt')
    expect(poslanyText).not.toContain('vynechany.txt')
  })
})
