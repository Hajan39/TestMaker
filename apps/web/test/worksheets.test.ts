import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { POST, PUT } from '@/app/api/tests/route'
import { db, testItems, tests } from '@/db'
import { copyTest, loadTest, loadTestItems, testConditions } from '@/lib/tests'
import { jsonReq, seedTemplate, seedTopic, seedAccount, ACCOUNT } from './helpers'

/**
 * Worksheets: saving via the shared tests API, separation from written tests
 * in the overview, and scope (someone else's worksheet looks nonexistent).
 */

let templateId: string
let gradeId: string
let topicId: string

beforeAll(async () => {
  templateId = await seedTemplate()
  const topic = await seedTopic({ topic: 'Sopky' })
  gradeId = topic.gradeId
  topicId = topic.topicId
})

const emptyHeader = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

const table = {
  header: ['Sopka', 'Stát'],
  rows: [[{ value: 'Etna', blank: false }, { value: 'Itálie', blank: true }]],
}
const question = {
  type: 'single_choice',
  points: 1,
  blocks: [],
  payload: { prompt: 'Která sopka je v Itálii?', options: ['Etna', 'Fudži'], correctIndex: 0 },
}

function worksheetItems() {
  return [
    { kind: 'heading', text: 'Sopky' },
    { kind: 'text', text: 'Sopka je otvor v zemské kůře.', content: { variant: 'text' } },
    { kind: 'text', text: 'Na Islandu je přes sto sopek.', content: { variant: 'fun_fact' }, needsCheck: true },
    { kind: 'table', content: table },
    { kind: 'question', question },
  ]
}

async function save(method: 'POST' | 'PUT', body: Record<string, unknown>): Promise<Response> {
  const handler = method === 'POST' ? POST : PUT
  return handler(
    jsonReq('/api/tests', method, {
      title: 'List o sopkách',
      description: null,
      templateId,
      header: emptyHeader,
      variants: 1,
      showKey: true,
      ...body,
    }),
  )
}

async function createWorksheet(body: Record<string, unknown> = {}): Promise<string> {
  const response = await save('POST', { kind: 'pracovni_list', graded: true, items: worksheetItems(), ...body })
  expect(response.status).toBe(200)
  return ((await response.json()) as { id: string }).id
}

describe('saving a worksheet', () => {
  it('saves texts, fun fact, table and snapshot-only task, and the worksheet is always ungraded', async () => {
    const id = await createWorksheet({ topicId, gradeId, brief: '{"title":"Sopky","instructions":"","ownText":""}' })
    const test = await loadTest(ACCOUNT, id)
    expect(test).toMatchObject({ kind: 'pracovni_list', graded: false, topicId, gradeId })

    const items = await loadTestItems(ACCOUNT, id)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'text', 'text', 'table', 'question'])
    expect(items[1]!.textContent).toEqual({ variant: 'text' })
    expect(items[2]).toMatchObject({ textContent: { variant: 'fun_fact' }, needsCheck: true })
    expect(items[3]!.table).toEqual(table)
    expect(items[4]!.questionId).toBeNull()
    expect(items[4]!.question?.payload).toMatchObject({ prompt: 'Která sopka je v Itálii?' })
  })

  it('re-saving with graded does not grade the worksheet and an edited task overwrites the old snapshot', async () => {
    const id = await createWorksheet()
    const saved = await loadTestItems(ACCOUNT, id)
    const items = saved.map((item) => ({
      id: item.id,
      kind: item.kind,
      text: item.text,
      content: item.kind === 'table' ? item.table : item.textContent,
      needsCheck: item.needsCheck,
      question: item.kind === 'question' ? { ...item.question, payload: { ...item.question!.payload, prompt: 'Upravená úloha?' } } : null,
    }))
    const response = await save('PUT', { id, graded: true, items })
    expect(response.status).toBe(200)
    expect((await loadTest(ACCOUNT, id))!.graded).toBe(false)
    const after = await loadTestItems(ACCOUNT, id)
    expect(after[4]!.question?.payload).toMatchObject({ prompt: 'Upravená úloha?' })
  })

  it('rejects an invalid table with a Czech message', async () => {
    const broken = { kind: 'table', content: { header: ['A'], rows: [[{ value: 'x', blank: false }]] } }
    const response = await save('POST', { kind: 'pracovni_list', items: [broken] })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/tabulk/i)
  })

  it('corrupted content in the database does not break loading the worksheet', async () => {
    const id = await createWorksheet()
    await db
      .update(testItems)
      .set({ content: { header: ['A'], rows: [[]] } })
      .where(and(eq(testItems.testId, id), eq(testItems.kind, 'table')))
    const items = await loadTestItems(ACCOUNT, id)
    expect(items).toHaveLength(5)
    expect(items.find((item) => item.kind === 'table')!.table).toBeNull()
  })

  it('a copy of a worksheet stays a worksheet with its content and flags', async () => {
    const id = await createWorksheet({ topicId })
    const copy = await copyTest(ACCOUNT, id)
    expect(await loadTest(ACCOUNT, copy!.id)).toMatchObject({ kind: 'pracovni_list', topicId, graded: false })
    const items = await loadTestItems(ACCOUNT, copy!.id)
    expect(items[2]).toMatchObject({ needsCheck: true, textContent: { variant: 'fun_fact' } })
    expect(items[3]!.table).toEqual(table)
    expect(items[4]!.question?.payload).toMatchObject({ prompt: 'Která sopka je v Itálii?' })
  })
})

describe('overviews and scope', () => {
  it('a worksheet is not in the tests overview and a test is not in the worksheets overview', async () => {
    const list = await createWorksheet({ title: 'List do přehledu' })
    const test = await save('POST', { title: 'Písemka do přehledu', graded: true, items: [] })
    const testId = ((await test.json()) as { id: string }).id

    const ids = async (kind?: 'pisemka' | 'pracovni_list') =>
      (
        await db
          .select({ id: tests.id })
          .from(tests)
          .where(and(...testConditions(ACCOUNT, kind ? { kind } : {})))
      ).map((row) => row.id)

    expect(await ids()).toContain(testId)
    expect(await ids()).not.toContain(list)
    expect(await ids('pracovni_list')).toContain(list)
    expect(await ids('pracovni_list')).not.toContain(testId)
  })

  it('someone else\'s private worksheet looks nonexistent', async () => {
    const id = await createWorksheet()
    const colleague = await seedAccount()
    expect(await loadTest(colleague, id)).toBeNull()
    expect(await loadTestItems(colleague, id)).toEqual([])
  })
})
