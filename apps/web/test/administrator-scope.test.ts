import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, puzzleWordDrafts, schools, testItems, tests, users } from '@/db'
import { newId } from '@/lib/ids'
import { copyTest, loadTest } from '@/lib/tests'
import { loadPuzzleWordDraft, savePuzzleWordDraft } from '@/lib/puzzles'
import { currentUser, type SignedInUser } from '@/lib/user'
import { seedTemplate, seedTopic } from './helpers'
import { TEST_SCHOOL_ID } from './setup'

/**
 * The administrator always works in one chosen school — with full rights there
 * including private tests, and cannot see into others until switching.
 * `currentUser` is called here without sign-in via `E2E_UZIVATEL`, as in the
 * other scope tests.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

async function school(name: string): Promise<string> {
  const id = newId()
  await db.insert(schools).values({ id, name: name, slug: id })
  return id
}

async function account(schoolId: string, role: 'ucitelka' | 'administrator', activeSchoolId?: string) {
  const id = newId()
  await db.insert(users).values({
    id,
    schoolId,
    email: `${id}@localhost`,
    name: `Účet ${id}`,
    role,
    activeSchoolId: activeSchoolId ?? null,
  })
  return id
}

async function privateTest(schoolId: string, ownerId: string): Promise<string> {
  const templateId = await seedTemplate()
  const id = newId()
  await db.insert(tests).values({
    id,
    schoolId,
    ownerId,
    visibility: 'soukrome',
    title: `Soukromá ${id}`,
    templateId,
    header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' } as never,
  })
  await db.insert(testItems).values({ id: newId(), schoolId, testId: id, position: 0, kind: 'question' })
  return id
}

async function asRole(userId: string): Promise<SignedInUser> {
  vi.stubEnv('E2E_UZIVATEL', userId)
  const signedIn = await currentUser()
  if (!signedIn) throw new Error('Účet se nenačetl')
  return signedIn
}

describe('the administrator\u0027s chosen school', () => {
  it('the scope carries the chosen school, the home school stays alongside', async () => {
    const second = await school('Druhá škola')
    const admin = await account(TEST_SCHOOL_ID, 'administrator', second)

    const signedIn = await asRole(admin)
    expect(signedIn.schoolId).toBe(second)
    expect(signedIn.schoolName).toBe('Druhá škola')
    expect(signedIn.homeSchoolId).toBe(TEST_SCHOOL_ID)
  })

  it('works in the home school without a choice', async () => {
    const admin = await account(TEST_SCHOOL_ID, 'administrator')
    const signedIn = await asRole(admin)
    expect(signedIn.schoolId).toBe(TEST_SCHOOL_ID)
    expect(signedIn.homeSchoolId).toBe(TEST_SCHOOL_ID)
  })

  it('a vanished chosen school sends the administrator home', async () => {
    const second = await school('Zmizí')
    const admin = await account(TEST_SCHOOL_ID, 'administrator', second)
    await db.delete(schools).where(eq(schools.id, second))

    const signedIn = await asRole(admin)
    expect(signedIn.schoolId).toBe(TEST_SCHOOL_ID)
  })

  it('another role ignores the chosen school even if its row has one', async () => {
    const second = await school('Nepatří jí')
    const teacher = await account(TEST_SCHOOL_ID, 'ucitelka', second)
    const signedIn = await asRole(teacher)
    expect(signedIn.schoolId).toBe(TEST_SCHOOL_ID)
  })
})

describe('full rights in the chosen school', () => {
  it('sees a local teacher\u0027s private test but not one of another school', async () => {
    const second = await school('Druhá')
    const third = await school('Třetí')
    const secondTest = await privateTest(second, await account(second, 'ucitelka'))
    const thirdTest = await privateTest(third, await account(third, 'ucitelka'))
    const admin = await asRole(await account(TEST_SCHOOL_ID, 'administrator', second))

    expect(await loadTest(admin, secondTest)).not.toBeNull()
    expect(await loadTest(admin, thirdTest)).toBeNull()
  })

  it('what it creates belongs to the chosen school', async () => {
    const second = await school('Druhá')
    const test = await privateTest(second, await account(second, 'ucitelka'))
    const admin = await asRole(await account(TEST_SCHOOL_ID, 'administrator', second))

    const copy = await copyTest(admin, test)
    expect(copy).not.toBeNull()
    const [row] = await db.select().from(tests).where(eq(tests.id, copy!.id))
    expect(row?.schoolId).toBe(second)
    expect(row?.ownerId).toBe(admin.userId)
  })

  it('draft puzzle words stay personal', async () => {
    const { topicId } = await seedTopic()
    const teacher = await asRole(await account(TEST_SCHOOL_ID, 'ucitelka'))
    await savePuzzleWordDraft(teacher, topicId, 'wordsearch', [{ word: 'ulita', clue: 'Schránka' }])

    const admin = await asRole(await account(TEST_SCHOOL_ID, 'administrator'))
    expect(await loadPuzzleWordDraft(admin, topicId, 'wordsearch')).toEqual([])

    await db.delete(puzzleWordDrafts)
  })
})
