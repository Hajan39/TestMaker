import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { POST, PUT } from '@/app/api/tests/route'
import { db, testItems, tests } from '@/db'
import { copyTest, loadTest, loadTestItems, testConditions } from '@/lib/tests'
import { jsonReq, seedTemplate, seedTopic, seedUcet, UCET } from './helpers'

/**
 * Pracovní listy: ukládání přes společné API testů, oddělení od písemek
 * v přehledu a rozsah (cizí list se tváří jako neexistující).
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

describe('ukládání pracovního listu', () => {
  it('uloží texty, fun fact, tabulku i úlohu jen ze snímku a list je vždy bez známek', async () => {
    const id = await createWorksheet({ topicId, gradeId, brief: '{"title":"Sopky","instructions":"","ownText":""}' })
    const test = await loadTest(UCET, id)
    expect(test).toMatchObject({ kind: 'pracovni_list', graded: false, topicId, gradeId })

    const items = await loadTestItems(UCET, id)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'text', 'text', 'table', 'question'])
    expect(items[1]!.textContent).toEqual({ variant: 'text' })
    expect(items[2]).toMatchObject({ textContent: { variant: 'fun_fact' }, needsCheck: true })
    expect(items[3]!.table).toEqual(table)
    expect(items[4]!.questionId).toBeNull()
    expect(items[4]!.question?.payload).toMatchObject({ prompt: 'Která sopka je v Itálii?' })
  })

  it('přeuložení s „na známky“ list neoznámkuje a upravená úloha přepíše starý snímek', async () => {
    const id = await createWorksheet()
    const saved = await loadTestItems(UCET, id)
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
    expect((await loadTest(UCET, id))!.graded).toBe(false)
    const after = await loadTestItems(UCET, id)
    expect(after[4]!.question?.payload).toMatchObject({ prompt: 'Upravená úloha?' })
  })

  it('neplatnou tabulku odmítne českou hláškou', async () => {
    const broken = { kind: 'table', content: { header: ['A'], rows: [[{ value: 'x', blank: false }]] } }
    const response = await save('POST', { kind: 'pracovni_list', items: [broken] })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/tabulk/i)
  })

  it('poškozený obsah v databázi neshodí načtení listu', async () => {
    const id = await createWorksheet()
    await db
      .update(testItems)
      .set({ content: { header: ['A'], rows: [[]] } })
      .where(and(eq(testItems.testId, id), eq(testItems.kind, 'table')))
    const items = await loadTestItems(UCET, id)
    expect(items).toHaveLength(5)
    expect(items.find((item) => item.kind === 'table')!.table).toBeNull()
  })

  it('kopie listu zůstane listem i s obsahem a značkami', async () => {
    const id = await createWorksheet({ topicId })
    const copy = await copyTest(UCET, id)
    expect(await loadTest(UCET, copy!.id)).toMatchObject({ kind: 'pracovni_list', topicId, graded: false })
    const items = await loadTestItems(UCET, copy!.id)
    expect(items[2]).toMatchObject({ needsCheck: true, textContent: { variant: 'fun_fact' } })
    expect(items[3]!.table).toEqual(table)
    expect(items[4]!.question?.payload).toMatchObject({ prompt: 'Která sopka je v Itálii?' })
  })
})

describe('přehledy a rozsah', () => {
  it('list není v přehledu písemek a písemka není v přehledu listů', async () => {
    const list = await createWorksheet({ title: 'List do přehledu' })
    const pisemka = await save('POST', { title: 'Písemka do přehledu', graded: true, items: [] })
    const pisemkaId = ((await pisemka.json()) as { id: string }).id

    const ids = async (kind?: 'pisemka' | 'pracovni_list') =>
      (
        await db
          .select({ id: tests.id })
          .from(tests)
          .where(and(...testConditions(UCET, kind ? { kind } : {})))
      ).map((row) => row.id)

    expect(await ids()).toContain(pisemkaId)
    expect(await ids()).not.toContain(list)
    expect(await ids('pracovni_list')).toContain(list)
    expect(await ids('pracovni_list')).not.toContain(pisemkaId)
  })

  it('cizí soukromý list se tváří jako neexistující', async () => {
    const id = await createWorksheet()
    const kolegyne = await seedUcet()
    expect(await loadTest(kolegyne, id)).toBeNull()
    expect(await loadTestItems(kolegyne, id)).toEqual([])
  })
})
