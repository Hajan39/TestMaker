import { describe, expect, it } from 'vitest'
import { db, schools, users } from '@/db'
import { loadLibraryTree, searchLibrary } from '@/lib/library'
import { countQuestions, loadQuestionPage, loadQuestions } from '@/lib/questions'
import { loadPickerTopics } from '@/lib/questionPicker'
import { buildPuzzleSnapshots, loadRenderableTest, loadTest, loadTestItems } from '@/lib/tests'
import { deletePuzzle, insertPuzzle, loadPuzzle, loadPuzzleList } from '@/lib/puzzles'
import { newId } from '@/lib/ids'
import { testItems, tests } from '@/db'
import type { Prihlaseny } from '@/lib/uzivatel'
import { UCET, seedQuestion, seedTemplate, seedTopic, seedUcet } from './helpers'

/**
 * Zámek proti nejhorší chybě téhle verze: aby po zavedení účtů nešlo
 * přečíst cizí písemku, cizí hlavolam nebo knihovnu jiné školy. Testuje se
 * na úrovni funkcí z `lib/*`, protože právě ony rozhodují o rozsahu — brána
 * je jen hrubé síto a o konkrétní řádky se nestará.
 */

const CIZI_SKOLA = 'skola-ciziho-mesta'

/** Učitelka z úplně jiné školy — pro ni nesmí být vidět vůbec nic. */
async function ciziSkola(): Promise<Prihlaseny> {
  await db
    .insert(schools)
    .values({ id: CIZI_SKOLA, name: 'Jiná škola', slug: 'jina' })
    .onConflictDoNothing()
  const id = newId()
  await db.insert(users).values({
    id,
    schoolId: CIZI_SKOLA,
    email: `${id}@jina.cz`,
    name: 'Cizí učitelka',
    role: 'spravce',
  })
  return {
    schoolId: CIZI_SKOLA,
    userId: id,
    role: 'spravce',
    jmeno: 'Cizí učitelka',
    email: `${id}@jina.cz`,
    skola: 'Jiná škola',
    domovskaSkolaId: CIZI_SKOLA,
    sid: 'bez-prihlaseni',
    mustChangePassword: false,
  }
}

/** Písemka konkrétní učitelky i s jednou položkou. */
async function seedTest(
  ucet: Prihlaseny,
  options: { questionId?: string; visibility?: 'soukrome' | 'skola' } = {},
): Promise<string> {
  const templateId = await seedTemplate()
  const id = newId()
  await db.insert(tests).values({
    id,
    schoolId: ucet.schoolId,
    ownerId: ucet.userId,
    visibility: options.visibility ?? 'soukrome',
    title: `Písemka ${id}`,
    templateId,
    header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' } as never,
  })
  await db.insert(testItems).values({
    id: newId(),
    schoolId: ucet.schoolId,
    testId: id,
    position: 0,
    kind: 'question',
    questionId: options.questionId ?? null,
  })
  return id
}

describe('knihovna se nedívá do jiné školy', () => {
  it('strom, hledání ani banka cizí obsah nevrátí', async () => {
    const { topicId } = await seedTopic({ subject: 'PŘÍRODOPIS', topic: 'Měkkýši' })
    await seedQuestion(topicId, { prompt: 'Kolik má hlemýžď ulit?' })
    const cizi = await ciziSkola()

    expect(await loadLibraryTree(cizi)).toEqual([])
    expect(await searchLibrary(cizi, 'Měkkýši')).toEqual([])
    expect((await loadQuestions(cizi)).items).toEqual([])
    expect(await countQuestions(cizi)).toBe(0)
    expect((await loadQuestionPage(cizi)).items).toEqual([])
    expect(await loadPickerTopics(cizi)).toEqual([])

    // A naopak: vlastní škola svoje data vidí, takže test neprojde omylem.
    expect(await countQuestions(UCET)).toBeGreaterThan(0)
  })
})

describe('písemka patří své autorce', () => {
  it('kolegyně ji nenajde, nenačte ani nevytiskne', async () => {
    const { topicId } = await seedTopic()
    const questionId = await seedQuestion(topicId)
    const testId = await seedTest(UCET, { questionId })
    const kolegyne = await seedUcet()

    expect(await loadTest(kolegyne, testId)).toBeNull()
    expect(await loadRenderableTest(kolegyne, testId, { variant: 'A', withKey: false })).toBeNull()
    expect(await loadTestItems(kolegyne, testId)).toEqual([])

    // Vlastnice ji vidí — jinak by test procházel jen proto, že je prázdná.
    expect(await loadTest(UCET, testId)).not.toBeNull()
  })

  it('nasdílenou písemku kolegyně otevře i vytiskne', async () => {
    const { topicId } = await seedTopic()
    const questionId = await seedQuestion(topicId)
    const testId = await seedTest(UCET, { questionId, visibility: 'skola' })
    const kolegyne = await seedUcet()

    expect(await loadTest(kolegyne, testId)).not.toBeNull()
    const renderable = await loadRenderableTest(kolegyne, testId, { variant: 'A', withKey: false })
    expect(renderable?.items).toHaveLength(1)
  })

  it('učitelka z jiné školy nedostane ani nasdílenou', async () => {
    const testId = await seedTest(UCET, { visibility: 'skola' })
    const cizi = await ciziSkola()
    expect(await loadTest(cizi, testId)).toBeNull()
  })
})

describe('hlavolam patří své autorce', () => {
  it('kolegyně ho nevidí v seznamu, nenačte ho ani ho nezmrazí do své písemky', async () => {
    const { topicId } = await seedTopic()
    const puzzle = await insertPuzzle(
      UCET,
      {
        kind: 'wordsearch',
        title: 'Měkkýši',
        instructions: '',
        entries: [
          { word: 'hlemýžď', clue: 'Plž s ulitou' },
          { word: 'ulita', clue: 'Schránka plže' },
        ],
        payload: { cols: 10, rows: 10, seed: 'rozsah', showClues: false },
      },
      { topicId },
    )
    const kolegyne = await seedUcet()

    expect(await loadPuzzleList(kolegyne)).toEqual([])
    expect(await loadPuzzle(kolegyne, puzzle.id)).toBeNull()
    expect(await deletePuzzle(kolegyne, puzzle.id)).toBe(false)

    // Zmrazit cizí hlavolam do vlastní písemky nejde — jinak by stačilo
    // uhodnout id a mít ho ve svém PDF.
    expect(await buildPuzzleSnapshots(kolegyne, [puzzle.id])).toEqual(new Map())
    expect((await buildPuzzleSnapshots(UCET, [puzzle.id])).size).toBe(1)
  })
})
