import { describe, expect, it } from 'vitest'
import { db, schools, users } from '@/db'
import { loadLibraryTree, searchLibrary } from '@/lib/library'
import { countQuestions, loadQuestionPage, loadQuestions } from '@/lib/questions'
import { loadPickerTopics } from '@/lib/questionPicker'
import { buildPuzzleSnapshots, loadRenderableTest, loadTest, loadTestItems } from '@/lib/tests'
import { deletePuzzle, insertPuzzle, loadPuzzle, loadPuzzleList } from '@/lib/puzzles'
import { newId } from '@/lib/ids'
import { testItems, tests } from '@/db'
import type { SignedInUser } from '@/lib/user'
import { ACCOUNT, seedQuestion, seedTemplate, seedTopic, seedAccount } from './helpers'

/**
 * A lock against the worst bug of this version: that with accounts in place
 * someone could read another person's test, puzzle or another school's
 * library. Tested at the level of `lib/*` functions, because they decide the
 * scope — the gate is only a coarse sieve and does not care about rows.
 */

const FOREIGN_SCHOOL = 'skola-ciziho-mesta'

/** A teacher from a completely different school — nothing at all may be visible to her. */
async function foreignSchool(): Promise<SignedInUser> {
  await db
    .insert(schools)
    .values({ id: FOREIGN_SCHOOL, name: 'Jiná škola', slug: 'jina' })
    .onConflictDoNothing()
  const id = newId()
  await db.insert(users).values({
    id,
    schoolId: FOREIGN_SCHOOL,
    email: `${id}@jina.cz`,
    name: 'Cizí učitelka',
    role: 'spravce',
  })
  return {
    schoolId: FOREIGN_SCHOOL,
    userId: id,
    role: 'spravce',
    name: 'Cizí učitelka',
    email: `${id}@jina.cz`,
    schoolName: 'Jiná škola',
    homeSchoolId: FOREIGN_SCHOOL,
    sid: 'bez-prihlaseni',
    mustChangePassword: false,
  }
}

/** A specific teacher's test with one item. */
async function seedTest(
  account: SignedInUser,
  options: { questionId?: string; visibility?: 'soukrome' | 'skola' } = {},
): Promise<string> {
  const templateId = await seedTemplate()
  const id = newId()
  await db.insert(tests).values({
    id,
    schoolId: account.schoolId,
    ownerId: account.userId,
    visibility: options.visibility ?? 'soukrome',
    title: `Písemka ${id}`,
    templateId,
    header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' } as never,
  })
  await db.insert(testItems).values({
    id: newId(),
    schoolId: account.schoolId,
    testId: id,
    position: 0,
    kind: 'question',
    questionId: options.questionId ?? null,
  })
  return id
}

describe('the library does not look into another school', () => {
  it('neither the tree, search nor bank returns foreign content', async () => {
    const { topicId } = await seedTopic({ subject: 'PŘÍRODOPIS', topic: 'Měkkýši' })
    await seedQuestion(topicId, { prompt: 'Kolik má hlemýžď ulit?' })
    const foreign = await foreignSchool()

    expect(await loadLibraryTree(foreign)).toEqual([])
    expect(await searchLibrary(foreign, 'Měkkýši')).toEqual([])
    expect((await loadQuestions(foreign)).items).toEqual([])
    expect(await countQuestions(foreign)).toBe(0)
    expect((await loadQuestionPage(foreign)).items).toEqual([])
    expect(await loadPickerTopics(foreign)).toEqual([])

    // And conversely: the own school sees its data, so the test does not pass by accident.
    expect(await countQuestions(ACCOUNT)).toBeGreaterThan(0)
  })
})

describe('a test belongs to its author', () => {
  it('a colleague can neither find, load nor print it', async () => {
    const { topicId } = await seedTopic()
    const questionId = await seedQuestion(topicId)
    const testId = await seedTest(ACCOUNT, { questionId })
    const colleague = await seedAccount()

    expect(await loadTest(colleague, testId)).toBeNull()
    expect(await loadRenderableTest(colleague, testId, { variant: 'A', withKey: false })).toBeNull()
    expect(await loadTestItems(colleague, testId)).toEqual([])

    // The owner sees it — otherwise the test would pass only because it is empty.
    expect(await loadTest(ACCOUNT, testId)).not.toBeNull()
  })

  it('a colleague opens and prints a shared test', async () => {
    const { topicId } = await seedTopic()
    const questionId = await seedQuestion(topicId)
    const testId = await seedTest(ACCOUNT, { questionId, visibility: 'skola' })
    const colleague = await seedAccount()

    expect(await loadTest(colleague, testId)).not.toBeNull()
    const renderable = await loadRenderableTest(colleague, testId, { variant: 'A', withKey: false })
    expect(renderable?.items).toHaveLength(1)
  })

  it('a teacher from another school does not get even a shared one', async () => {
    const testId = await seedTest(ACCOUNT, { visibility: 'skola' })
    const foreign = await foreignSchool()
    expect(await loadTest(foreign, testId)).toBeNull()
  })
})

describe('a puzzle belongs to its author', () => {
  it('a colleague neither sees it in the list, loads it nor freezes it into her test', async () => {
    const { topicId } = await seedTopic()
    const puzzle = await insertPuzzle(
      ACCOUNT,
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
    const colleague = await seedAccount()

    expect(await loadPuzzleList(colleague)).toEqual([])
    expect(await loadPuzzle(colleague, puzzle.id)).toBeNull()
    expect(await deletePuzzle(colleague, puzzle.id)).toBe(false)

    // Freezing someone else's puzzle into one's own test is impossible —
    // otherwise guessing the id would put it into one's PDF.
    expect(await buildPuzzleSnapshots(colleague, [puzzle.id])).toEqual(new Map())
    expect((await buildPuzzleSnapshots(ACCOUNT, [puzzle.id])).size).toBe(1)
  })
})
