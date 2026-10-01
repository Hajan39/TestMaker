import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DELETE, GET, PATCH, POST } from '@/app/api/library/route'
import { POST as createTest } from '@/app/api/tests/route'
import { db, grades, materials, questions, subjects, testItems, topics } from '@/db'
import { loadLibraryTree } from '@/lib/library'
import type { Scope } from '@/lib/user'
import { jsonReq, req, seedMaterial, seedQuestion, seedTemplate, seedTopic, ACCOUNT } from './helpers'

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

/**
 * Revision item 5 (the "Třídy" home without data): a teacher whose school has
 * nothing in the library yet should see an invitation to import on home, not
 * empty tiles without explanation. In `page.tsx` a single condition decides it
 * — `tree.length === 0` — with an `EmptyState` offering "Hromadný import" and
 * "Založit předmět" above it. The e2e suite can't reasonably prepare this state
 * (all test accounts share one seeded school), so it's verified at least here:
 * for a school without a single row `loadLibraryTree` returns an empty array.
 */
describe('the "Třídy" home without data', () => {
  it('loadLibraryTree returns an empty array for a school without a library', async () => {
    const emptySchool: Scope = { schoolId: 'skola-bez-knihovny-test', userId: ACCOUNT.userId, role: 'ucitelka' }
    const tree = await loadLibraryTree(emptySchool)
    expect(tree).toEqual([])
  })
})

describe('deletion impact preview', () => {
  it('counts materials and questions for a topic', async () => {
    const { topicId } = await seedTopic({ topic: 'Fotosyntéza' })
    await seedMaterial(topicId)
    await seedMaterial(topicId)
    await seedQuestion(topicId)

    const { status, body } = await impactOf('topic', topicId)
    expect(status).toBe(200)
    expect(body).toMatchObject({ name: 'Fotosyntéza', topics: 1, materials: 2, questions: 1 })
  })

  it('for a subject also adds up the grades and topics below it', async () => {
    const { subjectId, gradeId } = await seedTopic({ subject: 'Zeměpis' })
    const second = `${gradeId}-2`
    await db.insert(topics).values({ id: second, schoolId: ACCOUNT.schoolId, gradeId, name: 'Druhé téma' })
    await seedMaterial(second)

    const { body } = await impactOf('subject', subjectId)
    expect(body.name).toBe('Zeměpis')
    expect(body.grades).toBe(1)
    expect(body.topics).toBe(2)
    expect(body.materials).toBe(1)
  })

  it('names the tests the questions will drop out of', async () => {
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

  it('reports nothing for an empty topic', async () => {
    const { topicId } = await seedTopic()
    const { body } = await impactOf('topic', topicId)
    expect(body).toMatchObject({ topics: 1, materials: 0, questions: 0, affectedTests: [] })
  })

  it('an unknown id is 404 and a nonsense kind 400', async () => {
    expect((await impactOf('topic', 'neexistuje')).status).toBe(404)
    expect((await GET(req('/api/library?kind=vesmir&id=x'))).status).toBe(400)
    expect((await GET(req('/api/library?kind=topic'))).status).toBe(400)
  })
})

describe('deleting in the library', () => {
  it('deletes a topic with its materials and questions', async () => {
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

  it("a finished test's item survives deleting the question — it keeps the frozen content", async () => {
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
    // The link to the bank is gone (`set null`), the test content is not.
    expect(item?.questionId).toBeNull()
    expect(item?.questionSnapshot).toContain('Otázka na papíře')
  })

  it('deletes a subject with everything below it', async () => {
    const { subjectId, gradeId, topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId)

    expect((await remove('subject', subjectId)).status).toBe(200)

    expect(await db.select().from(subjects).where(eq(subjects.id, subjectId))).toHaveLength(0)
    expect(await db.select().from(grades).where(eq(grades.id, gradeId))).toHaveLength(0)
    expect(await db.select().from(topics).where(eq(topics.id, topicId))).toHaveLength(0)
    expect(await db.select().from(materials).where(eq(materials.id, materialId))).toHaveLength(0)
  })

  it('deleting a grade leaves the subject standing', async () => {
    const { subjectId, gradeId, topicId } = await seedTopic()

    expect((await remove('grade', gradeId)).status).toBe(200)

    expect(await db.select().from(subjects).where(eq(subjects.id, subjectId))).toHaveLength(1)
    expect(await db.select().from(topics).where(eq(topics.id, topicId))).toHaveLength(0)
  })

  it("doesn't delete a missing item and reports 404", async () => {
    expect((await remove('topic', 'neexistuje')).status).toBe(404)
  })
})

async function create(body: unknown): Promise<{ status: number; body: { id?: string; error?: string } }> {
  const response = await POST(jsonReq('/api/library', 'POST', body))
  return { status: response.status, body: (await response.json()) as { id?: string; error?: string } }
}

async function rename(body: unknown): Promise<{ status: number; body: { id?: string; error?: string } }> {
  const response = await PATCH(jsonReq('/api/library', 'PATCH', body))
  return { status: response.status, body: (await response.json()) as { id?: string; error?: string } }
}

describe('manual creation in the library', () => {
  it('creates a subject', async () => {
    const { status, body } = await create({ kind: 'subject', name: 'Vlastivěda' })
    expect(status).toBe(200)

    const [row] = await db.select().from(subjects).where(eq(subjects.id, body.id!))
    expect(row?.name).toBe('Vlastivěda')
  })

  it('creates a grade in a subject and sets its order by the number', async () => {
    const { body: subject } = await create({ kind: 'subject', name: 'Dějepis' })
    const { status, body } = await create({ kind: 'grade', name: '7. ročník', parentId: subject.id })
    expect(status).toBe(200)

    const [row] = await db.select().from(grades).where(eq(grades.id, body.id!))
    expect(row).toMatchObject({ name: '7. ročník', subjectId: subject.id, position: 7 })
  })

  it('creates an empty topic in a grade and marks it as a topic without text right away', async () => {
    const { gradeId } = await seedTopic()
    const { status, body } = await create({ kind: 'topic', name: 'Vlastní otázky', parentId: gradeId })
    expect(status).toBe(200)

    const [row] = await db.select().from(topics).where(eq(topics.id, body.id!))
    expect(row).toMatchObject({ name: 'Vlastní otázky', gradeId, usableCharCount: 0, lowContent: true })
  })

  it("doesn't merge a manually created topic with a similarly named one", async () => {
    const { gradeId } = await seedTopic({ topic: '6.22 Měkkýši (Mollusca)' })
    const { status, body } = await create({ kind: 'topic', name: 'Měkkýši', parentId: gradeId })
    expect(status).toBe(200)

    const rows = await db.select().from(topics).where(eq(topics.gradeId, gradeId))
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === body.id)?.name).toBe('Měkkýši')
  })

  it("an empty topic doesn't break the library overview or the counts", async () => {
    const { gradeId } = await seedTopic({ subject: 'Přehledový předmět' })
    const { body } = await create({ kind: 'topic', name: 'Zatím prázdné', parentId: gradeId })

    const tree = await loadLibraryTree(ACCOUNT)
    const grade = tree.flatMap((subject) => subject.grades).find((row) => row.id === gradeId)
    const topic = grade?.topics.find((row) => row.id === body.id)
    expect(topic).toMatchObject({
      name: 'Zatím prázdné',
      materialCount: 0,
      questionCount: 0,
      lowContent: true,
    })

    // And the deletion impact is computed over an empty topic too.
    expect((await impactOf('topic', body.id!)).body).toMatchObject({ materials: 0, questions: 0 })
  })

  it("doesn't create a grade without a subject or a topic without a grade and explains why", async () => {
    const withoutSubject = await create({ kind: 'grade', name: '9. ročník' })
    expect(withoutSubject.status).toBe(400)
    expect(withoutSubject.body.error).toContain('předmět')

    const withoutGrade = await create({ kind: 'topic', name: 'Osamocené téma' })
    expect(withoutGrade.status).toBe(400)
    expect(withoutGrade.body.error).toContain('ročník')
  })

  it('a missing parent is 404, not a crash', async () => {
    expect((await create({ kind: 'grade', name: '9. ročník', parentId: 'neexistuje' })).status).toBe(404)
    expect((await create({ kind: 'topic', name: 'Téma', parentId: 'neexistuje' })).status).toBe(404)
  })

  it('refuses an empty name', async () => {
    const { status, body } = await create({ kind: 'subject', name: '   ' })
    expect(status).toBe(400)
    expect(body.error).toContain('názvu')
  })

  it('refuses a second subject with the same name and a second grade in the same subject', async () => {
    const { body: subject } = await create({ kind: 'subject', name: 'Fyzika' })
    const again = await create({ kind: 'subject', name: 'Fyzika' })
    expect(again.status).toBe(409)
    expect(again.body.error).toContain('Fyzika')

    await create({ kind: 'grade', name: '8. ročník', parentId: subject.id })
    const gradeAgain = await create({ kind: 'grade', name: '8. ročník', parentId: subject.id })
    expect(gradeAgain.status).toBe(409)
  })
})

describe('renaming in the library', () => {
  it('renames a subject', async () => {
    const { subjectId } = await seedTopic({ subject: 'PRIRODOPIS' })

    expect((await rename({ kind: 'subject', id: subjectId, name: 'Přírodopis' })).status).toBe(200)
    const [row] = await db.select().from(subjects).where(eq(subjects.id, subjectId))
    expect(row?.name).toBe('Přírodopis')
  })

  it('renames a grade and recomputes its order too', async () => {
    const { subjectId, gradeId } = await seedTopic({ grade: '2. ročník' })
    // The order from the original name is 2 — after renaming it must match nine,
    // otherwise the grade would stay stuck among the small numbers in the sidebar.
    await db.update(grades).set({ position: 2 }).where(eq(grades.id, gradeId))

    expect((await rename({ kind: 'grade', id: gradeId, name: '9. ročník' })).status).toBe(200)
    const [row] = await db.select().from(grades).where(eq(grades.id, gradeId))
    expect(row).toMatchObject({ name: '9. ročník', position: 9, subjectId })

    // And the pane shows them in the right order: lower grade first.
    await create({ kind: 'grade', name: '3. ročník', parentId: subjectId })
    const tree = await loadLibraryTree(ACCOUNT)
    const subject = tree.find((row2) => row2.id === subjectId)
    expect(subject?.grades.map((grade) => grade.name)).toEqual(['3. ročník', '9. ročník'])
  })

  it('renames a topic', async () => {
    const { topicId } = await seedTopic({ topic: 'Stare jmeno' })
    expect((await rename({ kind: 'topic', id: topicId, name: 'Nové jméno' })).status).toBe(200)
    const [row] = await db.select().from(topics).where(eq(topics.id, topicId))
    expect(row?.name).toBe('Nové jméno')
  })

  it('refuses two subjects with the same name', async () => {
    const { subjectId } = await seedTopic({ subject: 'Chemie' })
    await create({ kind: 'subject', name: 'Zeměpis světa' })

    const { status, body } = await rename({ kind: 'subject', id: subjectId, name: 'Zeměpis světa' })
    expect(status).toBe(409)
    expect(body.error).toContain('Zeměpis světa')

    const [row] = await db.select().from(subjects).where(eq(subjects.id, subjectId))
    expect(row?.name).toBe('Chemie')
  })

  it('refuses two grades with the same name in one subject and advises what to do', async () => {
    const { subjectId, gradeId } = await seedTopic({ grade: '6. ročník' })
    await create({ kind: 'grade', name: '7. ročník', parentId: subjectId })

    const { status, body } = await rename({ kind: 'grade', id: gradeId, name: '7. ročník' })
    expect(status).toBe(409)
    expect(body.error).toContain('Upravit téma')
  })

  it('refuses two topics with the same name in a grade and offers merging', async () => {
    const { gradeId, topicId } = await seedTopic({ topic: 'Savci' })
    await create({ kind: 'topic', name: 'Ptáci', parentId: gradeId })

    const { status, body } = await rename({ kind: 'topic', id: topicId, name: 'Ptáci' })
    expect(status).toBe(409)
    expect(body.error).toContain('Sloučit do jiného tématu')
  })

  it('renaming to the same name passes', async () => {
    const { subjectId } = await seedTopic({ subject: 'Beze změny' })
    expect((await rename({ kind: 'subject', id: subjectId, name: 'Beze změny' })).status).toBe(200)
  })

  it('a missing item is 404 and an empty name 400', async () => {
    expect((await rename({ kind: 'topic', id: 'neexistuje', name: 'Cokoli' })).status).toBe(404)
    const { subjectId } = await seedTopic()
    expect((await rename({ kind: 'subject', id: subjectId, name: '  ' })).status).toBe(400)
  })
})
