import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db, puzzles, schools, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import { createSession } from '@/lib/user'
import type { TestVisibility } from '@testmaker/core/schema'
import { jsonReq, req, seedAccount, seedTemplate } from './helpers'
import { TEST_SCHOOL_ID } from './setup'

/**
 * A test shared for editing (`skola_uprava`): a colleague of the same school
 * may save it, but not delete it nor change who sees it; ownership never moves.
 */

/** The session cookie the mocked `cookies()` hands to `currentUser`. */
let cookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }),
  headers: async () => new Headers(),
}))

const { DELETE, PUT } = await import('@/app/api/tests/route')

const SECRET = 'tajemstvi-pro-upravy'
const FOREIGN_SCHOOL = 'skola-cizi-upravy'
const header = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

let templateId: string
let author: Awaited<ReturnType<typeof seedAccount>>
let colleague: Awaited<ReturnType<typeof seedAccount>>

beforeAll(async () => {
  templateId = await seedTemplate()
  author = await seedAccount()
  colleague = await seedAccount()
  await db.insert(schools).values({ id: FOREIGN_SCHOOL, name: 'Cizí škola', slug: 'cizi-upravy' }).onConflictDoNothing()
})

afterEach(() => {
  cookie = undefined
  vi.unstubAllEnvs()
})

async function signIn(userId: string): Promise<void> {
  vi.stubEnv('AUTH_SECRET', SECRET)
  const session = await createSession(userId)
  cookie = /tm_relace=([^;]+)/.exec(session)?.[1]
}

async function seedTest(visibility: TestVisibility, schoolId = TEST_SCHOOL_ID): Promise<string> {
  const id = newId()
  await db.insert(tests).values({
    id,
    schoolId,
    ownerId: author.userId,
    visibility,
    title: 'Dýchací soustava',
    templateId,
    header,
  })
  return id
}

function put(body: Record<string, unknown>): Promise<Response> {
  return PUT(
    jsonReq('/api/tests', 'PUT', {
      title: 'Dýchací soustava',
      description: null,
      templateId,
      header,
      variants: 1,
      showKey: true,
      items: [],
      ...body,
    }),
  )
}

async function stored(id: string) {
  const [row] = await db
    .select({ title: tests.title, ownerId: tests.ownerId, visibility: tests.visibility, variants: tests.variants })
    .from(tests)
    .where(eq(tests.id, id))
  return row
}

describe('a test shared for editing', () => {
  it('a colleague saves her changes and the author stays the owner', async () => {
    const id = await seedTest('skola_uprava')
    await signIn(colleague.userId)

    const response = await put({ id, title: 'Dýchací soustava — opraveno', variants: 2, visibility: 'skola_uprava' })
    expect(response.status).toBe(200)
    expect(await stored(id)).toEqual({
      title: 'Dýchací soustava — opraveno',
      ownerId: author.userId,
      visibility: 'skola_uprava',
      variants: 2,
    })
  })

  it('a colleague cannot change who sees it — the stored visibility stays', async () => {
    const id = await seedTest('skola_uprava')
    await signIn(colleague.userId)

    const response = await put({ id, title: 'Jen pro mě', visibility: 'soukrome' })
    expect(response.status).toBe(200)
    expect(await stored(id)).toMatchObject({ title: 'Jen pro mě', visibility: 'skola_uprava' })
  })

  it('the author still changes visibility', async () => {
    const id = await seedTest('skola_uprava')
    await signIn(author.userId)

    expect((await put({ id, visibility: 'skola' })).status).toBe(200)
    expect(await stored(id)).toMatchObject({ visibility: 'skola' })
  })

  it('a colleague keeps the author\'s puzzle in the test when saving', async () => {
    const id = await seedTest('skola_uprava')
    const puzzleId = newId()
    await db.insert(puzzles).values({
      id: puzzleId,
      schoolId: TEST_SCHOOL_ID,
      ownerId: author.userId,
      topicId: null,
      kind: 'wordsearch',
      title: 'Osmisměrka autorky',
      instructions: '',
      entries: [{ word: 'PLICE', clue: 'Orgán dýchání' }],
      payload: { cols: 10, rows: 10, seed: 'test', showClues: false },
    })
    const itemId = newId()
    await db.insert(testItems).values({
      id: itemId,
      schoolId: TEST_SCHOOL_ID,
      testId: id,
      position: 0,
      kind: 'puzzle',
      puzzleId,
      puzzleSnapshot: '{"frozen":true}',
    })
    await signIn(colleague.userId)

    const response = await put({ id, items: [{ id: itemId, kind: 'puzzle', puzzleId }] })
    expect(response.status).toBe(200)
    const items = await db
      .select({ puzzleId: testItems.puzzleId, puzzleSnapshot: testItems.puzzleSnapshot })
      .from(testItems)
      .where(eq(testItems.testId, id))
    expect(items).toEqual([{ puzzleId, puzzleSnapshot: '{"frozen":true}' }])
  })

  it('a colleague cannot delete it', async () => {
    const id = await seedTest('skola_uprava')
    await signIn(colleague.userId)

    const response = await DELETE(req(`/api/tests?id=${id}`, { method: 'DELETE' }))
    expect(response.status).toBe(404)
    expect(await stored(id)).toMatchObject({ ownerId: author.userId })
  })

  it('a test merely shared with the school is not editable by a colleague (404)', async () => {
    const id = await seedTest('skola')
    await signIn(colleague.userId)

    expect((await put({ id, title: 'Přepsáno' })).status).toBe(404)
    expect(await stored(id)).toMatchObject({ title: 'Dýchací soustava' })
  })

  it('a test shared for editing in another school is 404', async () => {
    const id = await seedTest('skola_uprava', FOREIGN_SCHOOL)
    await signIn(colleague.userId)

    expect((await put({ id, title: 'Přepsáno' })).status).toBe(404)
    expect(await stored(id)).toMatchObject({ title: 'Dýchací soustava' })
  })

  it('rejects an unknown visibility with 400', async () => {
    const id = await seedTest('skola_uprava')
    await signIn(author.userId)

    expect((await put({ id, visibility: 'vsichni' })).status).toBe(400)
    expect(await stored(id)).toMatchObject({ visibility: 'skola_uprava' })
  })
})
