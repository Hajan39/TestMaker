import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { generateWorksheet, regenerateWorksheetItem, WorksheetRequest } from '@testmaker/core/ai'

/**
 * Generating a worksheet and regenerating one piece. The real model is not
 * called: the core functions run for real (including item validation), only
 * the model call is replaced by a fake that returns `model.answer`.
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
const { auditLog, db, materials, testItems, tests, topics } = await import('@/db')
const { loadTest, loadTestItems } = await import('@/lib/tests')
const { jsonReq, seedMaterial, seedTemplate, seedTopic, seedAccount } = await import('./helpers')

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
  it('saves the worksheet and items from a topic, takes the grade from the topic and skips duplicate material', async () => {
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

    const test = await loadTest((await import('./helpers')).ACCOUNT, id)
    expect(test).toMatchObject({ kind: 'pracovni_list', graded: false, topicId, gradeId, title: 'Sopky a zemětřesení' })
    expect(JSON.parse(test!.brief!)).toEqual({ title: 'Sopky', instructions: 'víc tabulek', ownText: '', onlyMaterials: true })

    const items = await loadTestItems((await import('./helpers')).ACCOUNT, id)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'text', 'text', 'table', 'question'])
    expect(items.map((item) => item.needsCheck)).toEqual([false, false, true, false, false])
    expect(items[4]!.question?.payload).toMatchObject({ prompt: 'Kde je Etna?' })
  })

  it('saves a free-form brief with a foreign grade without grade and topic', async () => {
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

  it('a topic that disappeared meanwhile returns 404 with advice and saves nothing', async () => {
    const before = (await db.select().from(tests)).length
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicId: 'neni' }))
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: string }).error).toBe('Téma už v knihovně není, vyber jiné.')
    expect((await db.select().from(tests)).length).toBe(before)
  })

  it('returns 503 with an explanation without a model', async () => {
    model.configured = false
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'free', title: 'X' }))
    expect(response.status).toBe(503)
    expect(((await response.json()) as { error: string }).error).toMatch(/prázdný list/)
  })

  it('too few usable items end with a Czech error and save nothing', async () => {
    model.answer = { title: 'x', items: [text('Jen jedna věta.')] }
    const before = (await db.select().from(tests)).length
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'free', title: 'X' }))
    expect(response.status).toBe(502)
    expect(((await response.json()) as { error: string }).error).toMatch(/Zkus to znovu/)
    expect((await db.select().from(tests)).length).toBe(before)
  })

  it('a failed generation shows up in Správa with the technical detail', async () => {
    model.answer = { title: 'x', items: [text('Jen jedna věta.')] }
    await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'free', title: 'X' }))
    const [event] = await db.select().from(auditLog).where(eq(auditLog.action, 'list-chyba'))
    expect(event?.severity).toBe('chyba')
    expect((event?.detail as { technicky?: string }).technicky).toBeTruthy()
  })
})

describe('POST /api/worksheets/[id]/items/[itemId]/regenerate', () => {
  async function listId(): Promise<string> {
    const { topicId } = await topicWithMaterials()
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicId }))
    return ((await response.json()) as { id: string }).id
  }
  const params = (id: string, itemId = 'nova') => ({ params: Promise.resolve({ id, itemId }) })

  it('returns a new item from the same brief and materials', async () => {
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

  it('returns 404 for both a foreign worksheet and a foreign test', async () => {
    const id = await listId()
    const colleague = await seedAccount()
    await db.update(tests).set({ ownerId: colleague.userId }).where(eq(tests.id, id))
    const response = await regenerate(jsonReq('/x', 'POST', { target: { kind: 'text' }, existing: [] }), params(id))
    expect(response.status).toBe(404)
  })

  it('a deleted topic does not matter — it regenerates from the title', async () => {
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
