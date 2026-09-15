import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DELETE, GET } from '@/app/api/library/route'
import { POST as createTest } from '@/app/api/tests/route'
import { db, grades, materials, questions, subjects, testItems, topics } from '@/db'
import { jsonReq, req, seedMaterial, seedQuestion, seedTemplate, seedTopic } from './helpers'

interface Impact {
  name: string
  grades: number
  topics: number
  materials: number
  questions: number
  affectedTests: string[]
}

async function impactOf(kind: string, id: string): Promise<{ status: number; body: Impact }> {
  const response = await GET(req(`/api/library?kind=${kind}&id=${encodeURIComponent(id)}`))
  return { status: response.status, body: (await response.json()) as Impact }
}

async function remove(kind: string, id: string): Promise<Response> {
  return DELETE(req(`/api/library?kind=${kind}&id=${encodeURIComponent(id)}`, { method: 'DELETE' }))
}

describe('náhled dopadu smazání', () => {
  it('u tématu spočítá materiály i otázky', async () => {
    const { topicId } = await seedTopic({ topic: 'Fotosyntéza' })
    await seedMaterial(topicId)
    await seedMaterial(topicId)
    await seedQuestion(topicId)

    const { status, body } = await impactOf('topic', topicId)
    expect(status).toBe(200)
    expect(body).toMatchObject({ name: 'Fotosyntéza', topics: 1, materials: 2, questions: 1 })
  })

  it('u předmětu sečte i ročníky a témata pod ním', async () => {
    const { subjectId, gradeId } = await seedTopic({ subject: 'Zeměpis' })
    const second = `${gradeId}-2`
    await db.insert(topics).values({ id: second, gradeId, name: 'Druhé téma' })
    await seedMaterial(second)

    const { body } = await impactOf('subject', subjectId)
    expect(body.name).toBe('Zeměpis')
    expect(body.grades).toBe(1)
    expect(body.topics).toBe(2)
    expect(body.materials).toBe(1)
  })

  it('pojmenuje testy, ze kterých otázky vypadnou', async () => {
    const templateId = await seedTemplate()
    const { topicId } = await seedTopic()
    const questionId = await seedQuestion(topicId)

    await createTest(
      jsonReq('/api/tests', 'POST', {
        title: 'Opakování na konci roku',
        templateId,
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        items: [{ kind: 'question', questionId }],
      }),
    )

    const { body } = await impactOf('topic', topicId)
    expect(body.affectedTests).toContain('Opakování na konci roku')
  })

  it('u prázdného tématu nehlásí nic', async () => {
    const { topicId } = await seedTopic()
    const { body } = await impactOf('topic', topicId)
    expect(body).toMatchObject({ topics: 1, materials: 0, questions: 0, affectedTests: [] })
  })

  it('neznámé id je 404 a nesmyslný druh 400', async () => {
    expect((await impactOf('topic', 'neexistuje')).status).toBe(404)
    expect((await GET(req('/api/library?kind=vesmir&id=x'))).status).toBe(400)
    expect((await GET(req('/api/library?kind=topic'))).status).toBe(400)
  })
})

describe('mazání v knihovně', () => {
  it('smaže téma i s materiály a otázkami', async () => {
    const { topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId)
    const questionId = await seedQuestion(topicId)

    const response = await remove('topic', topicId)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })

    expect(await db.select().from(topics).where(eq(topics.id, topicId))).toHaveLength(0)
    expect(await db.select().from(materials).where(eq(materials.id, materialId))).toHaveLength(0)
    expect(await db.select().from(questions).where(eq(questions.id, questionId))).toHaveLength(0)
  })

  it('položka hotového testu smazání otázky přežije — zůstane jí zmrazený obsah', async () => {
    const templateId = await seedTemplate()
    const { topicId } = await seedTopic()
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka na papíře' })

    const created = await createTest(
      jsonReq('/api/tests', 'POST', {
        title: 'Vytištěná písemka',
        templateId,
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        items: [{ kind: 'question', questionId }],
      }),
    )
    const { id: testId } = (await created.json()) as { id: string }

    expect((await remove('topic', topicId)).status).toBe(200)

    const [item] = await db.select().from(testItems).where(eq(testItems.testId, testId))
    expect(item).toBeDefined()
    // Odkaz do banky zmizel (`set null`), obsah písemky ne.
    expect(item?.questionId).toBeNull()
    expect(item?.questionSnapshot).toContain('Otázka na papíře')
  })

  it('smaže předmět i se vším, co pod ním leží', async () => {
    const { subjectId, gradeId, topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId)

    expect((await remove('subject', subjectId)).status).toBe(200)

    expect(await db.select().from(subjects).where(eq(subjects.id, subjectId))).toHaveLength(0)
    expect(await db.select().from(grades).where(eq(grades.id, gradeId))).toHaveLength(0)
    expect(await db.select().from(topics).where(eq(topics.id, topicId))).toHaveLength(0)
    expect(await db.select().from(materials).where(eq(materials.id, materialId))).toHaveLength(0)
  })

  it('smazání ročníku nechá předmět stát', async () => {
    const { subjectId, gradeId, topicId } = await seedTopic()

    expect((await remove('grade', gradeId)).status).toBe(200)

    expect(await db.select().from(subjects).where(eq(subjects.id, subjectId))).toHaveLength(1)
    expect(await db.select().from(topics).where(eq(topics.id, topicId))).toHaveLength(0)
  })

  it('neexistující položku nesmaže a ohlásí 404', async () => {
    expect((await remove('topic', 'neexistuje')).status).toBe(404)
  })
})
