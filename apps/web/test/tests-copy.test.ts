import { asc, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { GET, POST } from '@/app/api/tests/route'
import { db, questions, testItems } from '@/db'
import { loadTest, loadTestItems } from '@/lib/tests'
import { jsonReq, req, seedQuestion, seedTemplate, seedTopic, UCET } from './helpers'

/**
 * Kopie testu a hledání v seznamu testů. Loňskou písemku musí jít použít
 * znovu, aniž by se přepsal originál — a najít ji mezi ostatními.
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

/** Zmrazené snímky položek testu v pořadí, v jakém jsou na papíře. */
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
  it('vznikne pod novým id a se stejným počtem položek ve stejném pořadí', async () => {
    const prvni = await seedQuestion(topicId, { prompt: 'První otázka' })
    const druha = await seedQuestion(topicId, { prompt: 'Druhá otázka' })
    const sourceId = await createTest([
      { kind: 'heading', text: 'Část A' },
      { kind: 'question', questionId: prvni },
      { kind: 'page_break' },
      { kind: 'question', questionId: druha },
    ])

    const kopie = await copyTest(sourceId)
    expect(kopie.status).toBe(200)
    expect(kopie.id).toBeTruthy()
    expect(kopie.id).not.toBe(sourceId)

    const puvodni = await loadTestItems(UCET, sourceId)
    const nove = await loadTestItems(UCET, kopie.id!)
    expect(nove).toHaveLength(puvodni.length)
    expect(nove.map((item) => item.kind)).toEqual(puvodni.map((item) => item.kind))
    expect(nove.map((item) => item.order)).toEqual(puvodni.map((item) => item.order))
    expect(nove.map((item) => item.questionId)).toEqual(puvodni.map((item) => item.questionId))
    expect(nove.map((item) => item.text)).toEqual(puvodni.map((item) => item.text))
    // Položky jsou vlastní záznamy kopie, ne sdílené s originálem.
    for (const item of nove) expect(puvodni.map((row) => row.id)).not.toContain(item.id)
  })

  it('přebírá zmrazené snímky, ne dnešní znění otázek z banky', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Znění při zařazení do testu' })
    const sourceId = await createTest([{ kind: 'question', questionId }])

    // Otázka se v bance mezitím změnila — kopie loňské písemky o tom nesmí vědět.
    await db
      .update(questions)
      .set({ payload: { prompt: 'Letošní změněné znění', options: ['a', 'b'], correctIndex: 0 } })
      .where(eq(questions.id, questionId))

    const kopie = await copyTest(sourceId)
    expect(kopie.status).toBe(200)

    expect(await snapshots(kopie.id!)).toEqual(await snapshots(sourceId))
    const [item] = await loadTestItems(UCET, kopie.id!)
    expect(item?.question?.payload).toMatchObject({ prompt: 'Znění při zařazení do testu' })
  })

  it('udrží obsah i u otázky, která z banky zmizela', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka, co zmizí' })
    const sourceId = await createTest([{ kind: 'question', questionId }])
    await db.delete(questions).where(eq(questions.id, questionId))

    const kopie = await copyTest(sourceId)
    const [item] = await loadTestItems(UCET, kopie.id!)
    expect(item?.question?.payload).toMatchObject({ prompt: 'Otázka, co zmizí' })
    expect(item?.questionMissing).toBe(true)
  })

  it('originál zůstane nedotčený a kopie se pozná podle názvu', async () => {
    const sourceId = await createTest([{ kind: 'heading', text: 'Jen nadpis' }], { title: 'Opakování' })
    const kopie = await copyTest(sourceId)

    expect((await loadTest(UCET, sourceId))?.title).toBe('Opakování')
    expect((await loadTest(UCET, kopie.id!))?.title).toBe('Opakování (kopie)')
  })

  it('kopírovat neexistující test se nedá a řekne to česky', async () => {
    const kopie = await copyTest('test-ktery-neni')
    expect(kopie.status).toBe(404)
    expect(kopie.error).toBe('Test se nenašel')
  })

  it('kopie si ponechá ročník testu, ze kterého vznikla', async () => {
    const { gradeId } = await seedTopic()
    const sourceId = await createTest([], { gradeId })

    const kopie = await copyTest(sourceId)
    expect(kopie.status).toBe(200)
    expect((await loadTest(UCET, kopie.id!))?.gradeId).toBe(gradeId)
  })
})

describe('hledání v seznamu testů', () => {
  it('vrátí jen testy, jejichž název odpovídá hledanému slovu', async () => {
    const hledany = await createTest([], { title: 'Čtvrtletní písemka z fotosyntézy' })
    await createTest([], { title: 'Desetiminutovka na měkkýše' })

    const response = await GET(req(`/api/tests?q=${encodeURIComponent('fotosyntéz')}`))
    const { tests } = (await response.json()) as { tests: { id: string }[] }
    expect(tests.map((test) => test.id)).toEqual([hledany])
  })

  it('filtr podle šablony pustí dál jen testy z té šablony', async () => {
    const jinaSablona = await seedTemplate('kompaktni')
    const naJine = await createTest([], { title: 'Test na jiné šabloně', templateId: jinaSablona })

    const response = await GET(req(`/api/tests?templateId=${encodeURIComponent(jinaSablona)}`))
    const { tests } = (await response.json()) as { tests: { id: string }[] }
    expect(tests.map((test) => test.id)).toEqual([naJine])
  })
})
