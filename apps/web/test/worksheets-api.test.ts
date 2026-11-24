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
  const callModel = async ({ prompt, signal }: { prompt: string; signal?: AbortSignal }) => {
    // Like the real SDK call: an aborted signal ends the call.
    if (signal?.aborted) throw signal.reason
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
const { auditLog, db, materials, schools, testItems, tests, topics } = await import('@/db')
const { loadTest, loadTestItems } = await import('@/lib/tests')
const { jsonReq, seedMaterial, seedTemplate, seedTopic, seedAccount } = await import('./helpers')
const { TEST_SCHOOL_ID } = await import('./setup')

/** Numbers the extra topics and schools, so their ids stay unique without randomness. */
let seeded = 0

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

/** Another topic in the same grade with one material. */
async function secondTopic(gradeId: string, name = 'Zemětřesení'): Promise<string> {
  const id = `tema-${name}-${++seeded}`
  await db.insert(topics).values({ id, schoolId: TEST_SCHOOL_ID, gradeId, name })
  await seedMaterial(id, { fileName: name === 'Zemětřesení' ? 'zeme.txt' : `${name}.txt`, text: `${name} vzniká v zemské kůře. `.repeat(5) })
  return id
}

/** A topic that belongs to another school. */
async function foreignTopic(gradeId: string): Promise<string> {
  const schoolId = `cizi-skola-${++seeded}`
  await db.insert(schools).values({ id: schoolId, name: 'Cizí škola', slug: schoolId })
  const id = `cizi-tema-${schoolId}`
  await db.insert(topics).values({ id, schoolId, gradeId, name: 'Cizí téma' })
  return id
}

describe('POST /api/worksheets/generate', () => {
  it('saves the worksheet and items from a topic, takes the grade from the topic and skips duplicate material', async () => {
    const { topicId, gradeId } = await topicWithMaterials()
    const response = await generate(
      jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicIds: [topicId], instructions: 'víc tabulek', ownText: '' }),
    )
    expect(response.status).toBe(200)
    const { id, dropped } = (await response.json()) as { id: string; dropped: number }
    // One broken item plus, in the default strict mode, the fun fact the model admits is not from the materials.
    expect(dropped).toBe(2)

    expect(model.requests[0]!.materials).toContain('magma')
    expect(model.requests[0]!.materials).not.toContain('DUPLICITNÍ')
    expect(model.requests[0]!.gradeName).toBe('6. ročník')

    const test = await loadTest((await import('./helpers')).ACCOUNT, id)
    expect(test).toMatchObject({ kind: 'pracovni_list', graded: false, topicId, gradeId, title: 'Sopky a zemětřesení' })
    expect(JSON.parse(test!.brief!)).toEqual({ title: 'Sopky', topicIds: [topicId], instructions: 'víc tabulek', ownText: '', onlyMaterials: true })

    const items = await loadTestItems((await import('./helpers')).ACCOUNT, id)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'text', 'table', 'question'])
    expect(items.every((item) => !item.needsCheck)).toBe(true)
    expect(items[3]!.question?.payload).toMatchObject({ prompt: 'Kde je Etna?' })
  })

  it('makes one worksheet from two topics: both materials under their names, joined title, first topic on the row', async () => {
    const { topicId, gradeId } = await topicWithMaterials()
    const second = await secondTopic(gradeId)
    const response = await generate(
      jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicIds: [topicId, second, topicId] }),
    )
    expect(response.status).toBe(200)
    const { id } = (await response.json()) as { id: string }

    const request = model.requests[0]!
    expect(request.title).toBe('Sopky a Zemětřesení')
    expect(request.materials).toMatch(/^## Téma: Sopky\n=== sopky.txt ===\nSopka vzniká/)
    expect(request.materials).toContain('## Téma: Zemětřesení\n=== zeme.txt ===\nZemětřesení vzniká')
    expect(request.materials).not.toContain('DUPLICITNÍ')
    expect(model.prompts[0]).toContain('Téma listu: Sopky a Zemětřesení')

    const [row] = await db.select().from(tests).where(eq(tests.id, id))
    expect(row).toMatchObject({ topicId, gradeId })
    expect(JSON.parse(row!.brief!)).toMatchObject({ title: 'Sopky a Zemětřesení', topicIds: [topicId, second] })
  })

  it('a topic of another school among the chosen ones fails the whole request with 404', async () => {
    const { topicId, gradeId } = await topicWithMaterials()
    const foreign = await foreignTopic(gradeId)
    const before = (await db.select().from(tests)).length
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicIds: [topicId, foreign] }))
    expect(response.status).toBe(404)
    expect(model.requests).toHaveLength(0)
    expect((await db.select().from(tests)).length).toBe(before)
  })

  it('an empty topic list is an incomplete brief (400)', async () => {
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicIds: [] }))
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/vyber téma/)
    expect(model.requests).toHaveLength(0)
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
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicIds: ['neni'] }))
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: string }).error).toBe('Některé z vybraných témat už v knihovně není, vyber jiné.')
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

  it('running out of time ends with a Czech 504 and advice, not a bare platform timeout', async () => {
    const timedOut = AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timedOut)
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'free', title: 'Sopky' }))
    expect(response.status).toBe(504)
    const { error } = (await response.json()) as { error: string }
    expect(error).toMatch(/příliš dlouho/)
    expect(await db.select().from(tests).where(eq(tests.title, 'Sopky'))).toHaveLength(0)
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
    const response = await generate(jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicIds: [topicId] }))
    return ((await response.json()) as { id: string }).id
  }
  const params = (id: string, itemId = 'nova') => ({ params: Promise.resolve({ id, itemId }) })

  it('returns a new item from the same brief and materials (editor toggle off overrides the brief)', async () => {
    const id = await listId()
    model.answer = { item: { kind: 'text', variant: 'fun_fact', text: 'Etna je nejvyšší činná sopka Evropy.', fromMaterials: false } }
    model.requests = []
    const response = await regenerate(
      jsonReq('/x', 'POST', {
        target: { kind: 'fun_fact' },
        existing: ['Sopka vzniká tam, kde magma proniká na povrch.'],
        onlyMaterials: false,
      }),
      params(id),
    )
    expect(response.status).toBe(200)
    const { item } = (await response.json()) as { item: { kind: string; needsCheck: boolean } }
    expect(item).toMatchObject({ kind: 'text', needsCheck: true })
    expect(model.requests[0]!.materials).toContain('magma')
    expect(model.prompts.at(-1)).toContain('Sopka vzniká tam')
  })

  it('keeps to the materials by default and refuses an item from outside them', async () => {
    const id = await listId()
    model.answer = { item: { kind: 'text', variant: 'fun_fact', text: 'Etna je nejvyšší činná sopka Evropy.', fromMaterials: false } }
    const response = await regenerate(jsonReq('/x', 'POST', { target: { kind: 'fun_fact' }, existing: [] }), params(id))
    expect(response.status).toBe(502)
  })

  it('returns 404 for both a foreign worksheet and a foreign test', async () => {
    const id = await listId()
    const colleague = await seedAccount()
    await db.update(tests).set({ ownerId: colleague.userId }).where(eq(tests.id, id))
    const response = await regenerate(jsonReq('/x', 'POST', { target: { kind: 'text' }, existing: [] }), params(id))
    expect(response.status).toBe(404)
  })

  it('regenerates from all the worksheet topics, dropping one deleted meanwhile', async () => {
    const { topicId, gradeId } = await topicWithMaterials()
    const second = await secondTopic(gradeId)
    const third = await secondTopic(gradeId, 'Gejzíry')
    const created = await generate(
      jsonReq('/api/worksheets/generate', 'POST', { source: 'topic', topicIds: [topicId, second, third] }),
    )
    const { id } = (await created.json()) as { id: string }
    await db.delete(topics).where(eq(topics.id, third))
    model.answer = { item: text('Nová věta.') }
    model.requests = []
    const response = await regenerate(jsonReq('/x', 'POST', { target: { kind: 'text' }, existing: [] }), params(id))
    expect(response.status).toBe(200)
    expect(model.requests[0]!.title).toBe('Sopky a Zemětřesení')
    expect(model.requests[0]!.materials).toContain('magma')
    expect(model.requests[0]!.materials).toContain('Zemětřesení vzniká')
    expect(model.requests[0]!.materials).not.toContain('Gejzíry')
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
