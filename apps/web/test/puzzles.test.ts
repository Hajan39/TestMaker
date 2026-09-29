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
import { jsonReq, req, seedMaterial, seedTemplate, seedTopic, seedUcet, UCET } from './helpers'

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
  models: ['google:gemini-flash-latest'],
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
    // Česká věta, ze které je poznat, co opravit — ne obecné „neplatná data".
    expect(error).toContain('aspoň 2')
    expect(error).not.toContain('Neplatná data')
  })

  it('neexistující téma se odmítne česky, ne pádem na cizím klíči', async () => {
    const response = await createPuzzle(
      jsonReq('/api/puzzles', 'POST', { topicId: 'neexistuje', puzzle: OSMISMERKA }),
    )
    expect(response.status).toBe(404)
    const { error } = (await response.json()) as { error: string }
    expect(error).toContain('téma se nenašlo')
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
        return { entries: [], rejected: [], models: [] }
      },
    })

    expect(poslanyText).toContain('pouzity.txt')
    expect(poslanyText).not.toContain('vynechany.txt')
  })
})

/** Téma v úplně jiné škole — z téhle školy nesmí být vidět ani jménem. */
async function seedCiziTema(): Promise<string> {
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

describe('rozsah hlavolamů v API', () => {
  it('hlavolam kolegyně se tváří jako neexistující ve všech cestách', async () => {
    const templateId = await seedTemplate()
    const kolegyne = await seedUcet()
    const cizi = await insertPuzzle(kolegyne, OSMISMERKA, { topicId: null })
    const params = () => ({ params: Promise.resolve({ id: cizi.id }) })

    expect((await getPuzzleRoute(req(`/api/puzzles/${cizi.id}`), params())).status).toBe(404)
    expect(
      (await updatePuzzleRoute(jsonReq(`/api/puzzles/${cizi.id}`, 'PUT', { puzzle: OSMISMERKA }), params()))
        .status,
    ).toBe(404)
    expect(
      (await deletePuzzleRoute(req(`/api/puzzles/${cizi.id}`, { method: 'DELETE' }), params())).status,
    ).toBe(404)
    expect((await puzzlePdf(req(`/api/puzzles/${cizi.id}/pdf`), params())).status).toBe(404)

    const created = await createTest(
      jsonReq('/api/tests', 'POST', { title: 'Moje písemka', templateId, header: {}, items: [] }),
    )
    const { id: testId } = (await created.json()) as { id: string }
    expect(
      (await addToTest(jsonReq(`/api/puzzles/${cizi.id}/to-test`, 'POST', { testId }), params())).status,
    ).toBe(404)
    expect(await loadTestItems(UCET, testId)).toEqual([])

    // Hlavolam kolegyně zůstal, jak byl.
    const [row] = await db.select().from(puzzles).where(eq(puzzles.id, cizi.id))
    expect(row?.title).toBe(OSMISMERKA.title)
  })

  it('téma jiné školy se k hlavolamu nepřipojí a jeho název neprosákne', async () => {
    const ciziTema = await seedCiziTema()

    const created = await createPuzzle(jsonReq('/api/puzzles', 'POST', { topicId: ciziTema, puzzle: OSMISMERKA }))
    expect(created.status).toBe(404)

    const saved = await insertPuzzle(UCET, OSMISMERKA, { topicId: null })
    const updated = await updatePuzzleRoute(
      jsonReq(`/api/puzzles/${saved.id}`, 'PUT', { puzzle: OSMISMERKA, topicId: ciziTema }),
      { params: Promise.resolve({ id: saved.id }) },
    )
    expect(updated.status).toBe(404)
    const [row] = await db.select().from(puzzles).where(eq(puzzles.id, saved.id))
    expect(row?.topicId).toBeNull()

    // I kdyby vazba v databázi vznikla jinudy, seznam název cizího tématu nevydá.
    await db.update(puzzles).set({ topicId: ciziTema }).where(eq(puzzles.id, saved.id))
    const listed = await listPuzzles(req('/api/puzzles'))
    const { puzzles: list } = (await listed.json()) as { puzzles: { id: string; topicName: string | null }[] }
    expect(list.find((item) => item.id === saved.id)?.topicName).toBeNull()
  })
})

describe('rozbitý hlavolam se netiskne ani nezařazuje', () => {
  /** Slovo delší než mřížka: uložit jde, vytisknout ne. */
  const ROZBITA = {
    ...OSMISMERKA,
    entries: [
      { word: 'fotosyntéza', clue: 'Děj v zelených listech' },
      { word: 'list', clue: 'Zelený orgán' },
    ],
    payload: { cols: 6, rows: 6, seed: 'rozbita', showClues: false },
  }

  it('uložit jako rozpracovaný jde', async () => {
    const response = await createPuzzle(jsonReq('/api/puzzles', 'POST', { topicId: null, puzzle: ROZBITA }))
    expect(response.status).toBe(200)
  })

  it('tisk i zařazení odmítne s českým vysvětlením', async () => {
    const templateId = await seedTemplate()
    const saved = await insertPuzzle(UCET, ROZBITA, { topicId: null })
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
    expect(await loadTestItems(UCET, testId)).toEqual([])
  })
})
