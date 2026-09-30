import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { generateWorksheet, regenerateWorksheetItem, WorksheetRequest } from '@testmaker/core/ai'

/**
 * Generování pracovního listu a přegenerování kusu. Skutečný model se
 * nevolá: funkce z core běží doopravdy (i s kontrolou položek), jen místo
 * modelu dostanou podvržené volání, které vrátí `model.answer`.
 */

const model = vi.hoisted(() => ({
  configured: true,
  answer: null as unknown,
  requests: [] as WorksheetRequest[],
  prompts: [] as string[],
}))

vi.mock('@testmaker/core/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@testmaker/core/ai')>()
  const callModel = async ({ prompt }: { prompt: string }) => {
    model.prompts.push(prompt)
    return model.answer
  }
  const models = [{ provider: 'google' as const, model: 'podvrzeny' }]
  return {
    ...original,
    isAiConfigured: () => model.configured,
    generateWorksheet: (async (request, options) => {
      model.requests.push(request)
      return original.generateWorksheet(request, { ...options, models, callModel })
    }) satisfies typeof generateWorksheet,
    regenerateWorksheetItem: (async (request, target, existing, options) => {
      model.requests.push(request)
      return original.regenerateWorksheetItem(request, target, existing, { ...options, models, callModel })
    }) satisfies typeof regenerateWorksheetItem,
  }
})

const { POST: generate } = await import('@/app/api/worksheets/generate/route')
const { POST: regenerate } = await import('@/app/api/worksheets/[id]/items/[itemId]/regenerate/route')
const { db, materials, testItems, tests, topics } = await import('@/db')
const { loadTest, loadTestItems } = await import('@/lib/tests')
const { jsonReq, seedMaterial, seedTemplate, seedTopic, seedUcet } = await import('./helpers')

const text = (value: string, fromMaterials = true) => ({ kind: 'text', variant: 'text', text: value, fromMaterials })
const LIST = {
  title: 'Sopky a zemětřesení',
  items: [
    { kind: 'heading', text: 'Sopky', fromMaterials: false },
    text('Sopka vzniká tam, kde magma proniká na povrch.'),
    { kind: 'text', variant: 'fun_fact', text: 'Na Islandu je přes sto sopek.', fromMaterials: false },
    {
      kind: 'table',
      fromMaterials: true,
      table: { header: ['Sopka', 'Stát'], rows: [[{ value: 'Etna', blank: false }, { value: 'Itálie', blank: true }]] },
    },
    {
      kind: 'question',
      fromMaterials: true,
      question: {
        type: 'single_choice',
        points: 1,
        payload: { prompt: 'Kde je Etna?', options: ['V Itálii', 'V Japonsku'], correctIndex: 0 },
      },
    },
    { kind: 'question', fromMaterials: true, question: { type: 'single_choice', points: 1, payload: { prompt: 'Vadná', options: ['a'], correctIndex: 5 } } },
  ],
}

beforeEach(async () => {
  model.configured = true
  model.answer = LIST
  model.requests = []
  model.prompts = []
  await seedTemplate()
})

async function topicWithMaterials(): Promise<{ topicId: string; gradeId: string }> {
  const { topicId, gradeId } = await seedTopic({ topic: 'Sopky', grade: '6. ročník' })
  await seedMaterial(topicId, { fileName: 'sopky.txt', text: 'Sopka vzniká tam, kde magma proniká na povrch. '.repeat(5) })
  const duplicate = await seedMaterial(topicId, { fileName: 'kopie.txt', text: 'DUPLICITNÍ OBSAH '.repeat(5) })
  const [original] = await db.select({ id: materials.id }).from(materials).where(eq(materials.fileName, 'sopky.txt'))
  await db.update(materials).set({ duplicateOfId: original!.id }).where(eq(materials.id, duplicate))
  return { topicId, gradeId }
}

describe('POST /api/worksheets/generate', () => {
  it('z tématu uloží list i položky, ročník vezme z tématu a duplicitní materiál vynechá', async () => {
    const { topicId, gradeId } = await topicWithMaterials()
    const response = await generate(
      jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicId, instructions: 'víc tabulek', ownText: '' }),
    )
    expect(response.status).toBe(200)
    const { id, dropped } = (await response.json()) as { id: string; dropped: number }
    expect(dropped).toBe(1)

    expect(model.requests[0]!.materials).toContain('magma')
    expect(model.requests[0]!.materials).not.toContain('DUPLICITNÍ')
    expect(model.requests[0]!.gradeName).toBe('6. ročník')

    const test = await loadTest((await import('./helpers')).UCET, id)
    expect(test).toMatchObject({ kind: 'pracovni_list', graded: false, topicId, gradeId, title: 'Sopky a zemětřesení' })
    expect(JSON.parse(test!.brief!)).toEqual({ title: 'Sopky', instructions: 'víc tabulek', ownText: '' })

    const items = await loadTestItems((await import('./helpers')).UCET, id)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'text', 'text', 'table', 'question'])
    expect(items.map((item) => item.needsCheck)).toEqual([false, false, true, false, false])
    expect(items[4]!.question?.payload).toMatchObject({ prompt: 'Kde je Etna?' })
  })

  it('volné zadání s cizím ročníkem uloží bez ročníku a bez tématu', async () => {
    const response = await generate(
      jsonReq('/api/worksheets/generate', 'POST', {
        source: 'free',
        title: 'Vesmír',
        gradeId: 'cizi-rocnik',
        ownText: 'Slunce je hvězda.',
      }),
    )
    expect(response.status).toBe(200)
    const { id } = (await response.json()) as { id: string }
    const [row] = await db.select().from(tests).where(eq(tests.id, id))
    expect(row).toMatchObject({ gradeId: null, topicId: null, kind: 'pracovni_list' })
    expect(model.requests[0]).toMatchObject({ title: 'Vesmír', ownText: 'Slunce je hvězda.', materials: '' })
  })

  it('téma, které mezitím zmizelo, vrátí 404 s radou a nic neuloží', async () => {
    const before = (await db.select().from(tests)).length
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicId: 'neni' }))
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: string }).error).toBe('Téma už v knihovně není, vyber jiné.')
    expect((await db.select().from(tests)).length).toBe(before)
  })

  it('bez modelu vrátí 503 s vysvětlením', async () => {
    model.configured = false
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'free', title: 'X' }))
    expect(response.status).toBe(503)
    expect(((await response.json()) as { error: string }).error).toMatch(/prázdný list/)
  })

  it('málo použitelných položek skončí českou chybou a nic neuloží', async () => {
    model.answer = { title: 'x', items: [text('Jen jedna věta.')] }
    const before = (await db.select().from(tests)).length
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'free', title: 'X' }))
    expect(response.status).toBe(502)
    expect(((await response.json()) as { error: string }).error).toMatch(/Zkus to znovu/)
    expect((await db.select().from(tests)).length).toBe(before)
  })
})

describe('POST /api/worksheets/[id]/items/[itemId]/regenerate', () => {
  async function listId(): Promise<string> {
    const { topicId } = await topicWithMaterials()
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicId }))
    return ((await response.json()) as { id: string }).id
  }
  const params = (id: string, itemId = 'nova') => ({ params: Promise.resolve({ id, itemId }) })

  it('vrátí novou položku z téhož zadání a materiálů', async () => {
    const id = await listId()
    model.answer = { item: { kind: 'text', variant: 'fun_fact', text: 'Etna je nejvyšší činná sopka Evropy.', fromMaterials: false } }
    model.requests = []
    const response = await regenerate(
      jsonReq('/x', 'POST', { target: { kind: 'fun_fact' }, existing: ['Sopka vzniká tam, kde magma proniká na povrch.'] }),
      params(id),
    )
    expect(response.status).toBe(200)
    const { item } = (await response.json()) as { item: { kind: string; needsCheck: boolean } }
    expect(item).toMatchObject({ kind: 'text', needsCheck: true })
    expect(model.requests[0]!.materials).toContain('magma')
    expect(model.prompts.at(-1)).toContain('Sopka vzniká tam')
  })

  it('cizí list i písemka vrátí 404', async () => {
    const id = await listId()
    const kolegyne = await seedUcet()
    await db.update(tests).set({ ownerId: kolegyne.userId }).where(eq(tests.id, id))
    const response = await regenerate(jsonReq('/x', 'POST', { target: { kind: 'text' }, existing: [] }), params(id))
    expect(response.status).toBe(404)
  })

  it('smazané téma nevadí — přegeneruje se z názvu', async () => {
    const id = await listId()
    const [row] = await db.select({ topicId: tests.topicId }).from(tests).where(eq(tests.id, id))
    await db.delete(testItems).where(eq(testItems.testId, id))
    await db.delete(materials).where(eq(materials.topicId, row!.topicId!))
    await db.delete(topics).where(eq(topics.id, row!.topicId!))
    model.answer = { item: text('Nová věta.') }
    model.requests = []
    const response = await regenerate(jsonReq('/x', 'POST', { target: { kind: 'text' }, existing: [] }), params(id))
    expect(response.status).toBe(200)
    expect(model.requests[0]).toMatchObject({ title: 'Sopky', materials: '' })
  })

  it('bez modelu 503', async () => {
    const id = await listId()
    model.configured = false
    const response = await regenerate(jsonReq('/x', 'POST', { target: { kind: 'text' }, existing: [] }), params(id))
    expect(response.status).toBe(503)
  })
})
