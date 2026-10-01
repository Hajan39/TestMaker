import { asc, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { GET, POST } from '@/app/api/tests/route'
import { db, questions, testItems } from '@/db'
import { loadTest, loadTestItems } from '@/lib/tests'
import { jsonReq, req, seedQuestion, seedTemplate, seedTopic, ACCOUNT } from './helpers'

/**
 * Copying a test and searching the test list. Last year's test must be
 * reusable without overwriting the original — and findable among the others.
 */

let templateId: string
let topicId: string

beforeAll(async () => {
  templateId = await seedTemplate()
  topicId = (await seedTopic()).topicId
})

const emptyHeader = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

async function createTest(items: unknown[], overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await POST(
    jsonReq('/api/tests', 'POST', {
      title: 'Písemka z loňska',
      description: null,
      graded: true,
      templateId,
      header: emptyHeader,
      variants: 1,
      showKey: true,
      items,
      ...overrides,
    }),
  )
  expect(response.status).toBe(200)
  const { id } = (await response.json()) as { id: string }
  return id
}

/** Frozen snapshots of the test items in the order they appear on paper. */
async function snapshots(testId: string): Promise<(string | null)[]> {
  const rows = await db
    .select({ questionSnapshot: testItems.questionSnapshot })
    .from(testItems)
    .where(eq(testItems.testId, testId))
    .orderBy(asc(testItems.position))
  return rows.map((row) => row.questionSnapshot)
}

async function copyTest(sourceId: string): Promise<{ status: number; id?: string; error?: string }> {
  const response = await POST(req(`/api/tests?copyOf=${encodeURIComponent(sourceId)}`, { method: 'POST' }))
  const body = (await response.json()) as { id?: string; error?: string }
  return { status: response.status, ...body }
}

describe('kopie testu', () => {
  it('is created under a new id with the same number of items in the same order', async () => {
    const first = await seedQuestion(topicId, { prompt: 'První otázka' })
    const second = await seedQuestion(topicId, { prompt: 'Druhá otázka' })
    const sourceId = await createTest([
      { kind: 'heading', text: 'Část A' },
      { kind: 'question', questionId: first },
      { kind: 'page_break' },
      { kind: 'question', questionId: second },
    ])

    const copy = await copyTest(sourceId)
    expect(copy.status).toBe(200)
    expect(copy.id).toBeTruthy()
    expect(copy.id).not.toBe(sourceId)

    const original = await loadTestItems(ACCOUNT, sourceId)
    const newPassword = await loadTestItems(ACCOUNT, copy.id!)
    expect(newPassword).toHaveLength(original.length)
    expect(newPassword.map((item) => item.kind)).toEqual(original.map((item) => item.kind))
    expect(newPassword.map((item) => item.order)).toEqual(original.map((item) => item.order))
    expect(newPassword.map((item) => item.questionId)).toEqual(original.map((item) => item.questionId))
    expect(newPassword.map((item) => item.text)).toEqual(original.map((item) => item.text))
    // The items are the copy's own rows, not shared with the original.
    for (const item of newPassword) expect(original.map((row) => row.id)).not.toContain(item.id)
  })

  it('takes over frozen snapshots, not the current wording from the bank', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Znění při zařazení do testu' })
    const sourceId = await createTest([{ kind: 'question', questionId }])

    // The question changed in the bank meanwhile — the copy of last year's test must not know.
    await db
      .update(questions)
      .set({ payload: { prompt: 'Letošní změněné znění', options: ['a', 'b'], correctIndex: 0 } })
      .where(eq(questions.id, questionId))

    const copy = await copyTest(sourceId)
    expect(copy.status).toBe(200)

    expect(await snapshots(copy.id!)).toEqual(await snapshots(sourceId))
    const [item] = await loadTestItems(ACCOUNT, copy.id!)
    expect(item?.question?.payload).toMatchObject({ prompt: 'Znění při zařazení do testu' })
  })

  it('keeps the content of a question that disappeared from the bank', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka, co zmizí' })
    const sourceId = await createTest([{ kind: 'question', questionId }])
    await db.delete(questions).where(eq(questions.id, questionId))

    const copy = await copyTest(sourceId)
    const [item] = await loadTestItems(ACCOUNT, copy.id!)
    expect(item?.question?.payload).toMatchObject({ prompt: 'Otázka, co zmizí' })
    expect(item?.questionMissing).toBe(true)
  })

  it('leaves the original untouched and marks the copy by its title', async () => {
    const sourceId = await createTest([{ kind: 'heading', text: 'Jen nadpis' }], { title: 'Opakování' })
    const copy = await copyTest(sourceId)

    expect((await loadTest(ACCOUNT, sourceId))?.title).toBe('Opakování')
    expect((await loadTest(ACCOUNT, copy.id!))?.title).toBe('Opakování (kopie)')
  })

  it('cannot copy a nonexistent test and says so in Czech', async () => {
    const copy = await copyTest('test-ktery-neni')
    expect(copy.status).toBe(404)
    expect(copy.error).toBe('Test se nenašel')
  })

  it('the copy keeps the grade of its source test', async () => {
    const { gradeId } = await seedTopic()
    const sourceId = await createTest([], { gradeId })

    const copy = await copyTest(sourceId)
    expect(copy.status).toBe(200)
    expect((await loadTest(ACCOUNT, copy.id!))?.gradeId).toBe(gradeId)
  })
})

describe('searching the test list', () => {
  it('returns only tests whose title matches the search term', async () => {
    const searched = await createTest([], { title: 'Čtvrtletní písemka z fotosyntézy' })
    await createTest([], { title: 'Desetiminutovka na měkkýše' })

    const response = await GET(req(`/api/tests?q=${encodeURIComponent('fotosyntéz')}`))
    const { tests } = (await response.json()) as { tests: { id: string }[] }
    expect(tests.map((test) => test.id)).toEqual([searched])
  })

  it('the template filter lets through only tests of that template', async () => {
    const otherTemplate = await seedTemplate('kompaktni')
    const toOther = await createTest([], { title: 'Test na jiné šabloně', templateId: otherTemplate })

    const response = await GET(req(`/api/tests?templateId=${encodeURIComponent(otherTemplate)}`))
    const { tests } = (await response.json()) as { tests: { id: string }[] }
    expect(tests.map((test) => test.id)).toEqual([toOther])
  })
})
