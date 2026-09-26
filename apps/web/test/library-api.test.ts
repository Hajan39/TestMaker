import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DELETE, GET, PATCH, POST } from '@/app/api/library/route'
import { POST as createTest } from '@/app/api/tests/route'
import { db, grades, materials, questions, subjects, testItems, topics } from '@/db'
import { loadLibraryTree } from '@/lib/library'
import { jsonReq, req, seedMaterial, seedQuestion, seedTemplate, seedTopic, UCET } from './helpers'

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
    await db.insert(topics).values({ id: second, schoolId: UCET.schoolId, gradeId, name: 'Druhé téma' })
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

async function create(body: unknown): Promise<{ status: number; body: { id?: string; error?: string } }> {
  const response = await POST(jsonReq('/api/library', 'POST', body))
  return { status: response.status, body: (await response.json()) as { id?: string; error?: string } }
}

async function rename(body: unknown): Promise<{ status: number; body: { id?: string; error?: string } }> {
  const response = await PATCH(jsonReq('/api/library', 'PATCH', body))
  return { status: response.status, body: (await response.json()) as { id?: string; error?: string } }
}

describe('ruční zakládání v knihovně', () => {
  it('založí předmět', async () => {
    const { status, body } = await create({ kind: 'subject', name: 'Vlastivěda' })
    expect(status).toBe(200)

    const [row] = await db.select().from(subjects).where(eq(subjects.id, body.id!))
    expect(row?.name).toBe('Vlastivěda')
  })

  it('založí ročník v předmětu a srovná mu řazení podle čísla', async () => {
    const { body: subject } = await create({ kind: 'subject', name: 'Dějepis' })
    const { status, body } = await create({ kind: 'grade', name: '7. ročník', parentId: subject.id })
    expect(status).toBe(200)

    const [row] = await db.select().from(grades).where(eq(grades.id, body.id!))
    expect(row).toMatchObject({ name: '7. ročník', subjectId: subject.id, position: 7 })
  })

  it('založí prázdné téma v ročníku a rovnou ho označí jako téma bez textu', async () => {
    const { gradeId } = await seedTopic()
    const { status, body } = await create({ kind: 'topic', name: 'Vlastní otázky', parentId: gradeId })
    expect(status).toBe(200)

    const [row] = await db.select().from(topics).where(eq(topics.id, body.id!))
    expect(row).toMatchObject({ name: 'Vlastní otázky', gradeId, usableCharCount: 0, lowContent: true })
  })

  it('nesloučí ručně založené téma s podobně pojmenovaným', async () => {
    const { gradeId } = await seedTopic({ topic: '6.22 Měkkýši (Mollusca)' })
    const { status, body } = await create({ kind: 'topic', name: 'Měkkýši', parentId: gradeId })
    expect(status).toBe(200)

    const rows = await db.select().from(topics).where(eq(topics.gradeId, gradeId))
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === body.id)?.name).toBe('Měkkýši')
  })

  it('prázdné téma nerozbije přehled knihovny ani počty', async () => {
    const { gradeId } = await seedTopic({ subject: 'Přehledový předmět' })
    const { body } = await create({ kind: 'topic', name: 'Zatím prázdné', parentId: gradeId })

    const tree = await loadLibraryTree(UCET)
    const grade = tree.flatMap((subject) => subject.grades).find((row) => row.id === gradeId)
    const topic = grade?.topics.find((row) => row.id === body.id)
    expect(topic).toMatchObject({
      name: 'Zatím prázdné',
      materialCount: 0,
      questionCount: 0,
      approvedCount: 0,
      lowContent: true,
    })

    // A dopad smazání se nad prázdným tématem spočítá taky.
    expect((await impactOf('topic', body.id!)).body).toMatchObject({ materials: 0, questions: 0 })
  })

  it('ročník bez předmětu ani téma bez ročníku nezaloží a vysvětlí proč', async () => {
    const bezPredmetu = await create({ kind: 'grade', name: '9. ročník' })
    expect(bezPredmetu.status).toBe(400)
    expect(bezPredmetu.body.error).toContain('předmět')

    const bezRocniku = await create({ kind: 'topic', name: 'Osamocené téma' })
    expect(bezRocniku.status).toBe(400)
    expect(bezRocniku.body.error).toContain('ročník')
  })

  it('neexistující nadřazená položka je 404, ne pád', async () => {
    expect((await create({ kind: 'grade', name: '9. ročník', parentId: 'neexistuje' })).status).toBe(404)
    expect((await create({ kind: 'topic', name: 'Téma', parentId: 'neexistuje' })).status).toBe(404)
  })

  it('odmítne prázdný název', async () => {
    const { status, body } = await create({ kind: 'subject', name: '   ' })
    expect(status).toBe(400)
    expect(body.error).toContain('názvu')
  })

  it('odmítne druhý předmět téhož jména i druhý ročník v témž předmětu', async () => {
    const { body: subject } = await create({ kind: 'subject', name: 'Fyzika' })
    const znovu = await create({ kind: 'subject', name: 'Fyzika' })
    expect(znovu.status).toBe(409)
    expect(znovu.body.error).toContain('Fyzika')

    await create({ kind: 'grade', name: '8. ročník', parentId: subject.id })
    const rocnikZnovu = await create({ kind: 'grade', name: '8. ročník', parentId: subject.id })
    expect(rocnikZnovu.status).toBe(409)
  })
})

describe('přejmenování v knihovně', () => {
  it('přejmenuje předmět', async () => {
    const { subjectId } = await seedTopic({ subject: 'PRIRODOPIS' })

    expect((await rename({ kind: 'subject', id: subjectId, name: 'Přírodopis' })).status).toBe(200)
    const [row] = await db.select().from(subjects).where(eq(subjects.id, subjectId))
    expect(row?.name).toBe('Přírodopis')
  })

  it('přejmenuje ročník a přepočítá i jeho řazení', async () => {
    const { subjectId, gradeId } = await seedTopic({ grade: '2. ročník' })
    // Řazení z původního názvu je 2 — po přejmenování musí odpovídat devítce,
    // jinak by ročník v postranním panelu zůstal viset mezi malými čísly.
    await db.update(grades).set({ position: 2 }).where(eq(grades.id, gradeId))

    expect((await rename({ kind: 'grade', id: gradeId, name: '9. ročník' })).status).toBe(200)
    const [row] = await db.select().from(grades).where(eq(grades.id, gradeId))
    expect(row).toMatchObject({ name: '9. ročník', position: 9, subjectId })

    // A panel je vidí ve správném pořadí: nižší ročník napřed.
    await create({ kind: 'grade', name: '3. ročník', parentId: subjectId })
    const tree = await loadLibraryTree(UCET)
    const subject = tree.find((row2) => row2.id === subjectId)
    expect(subject?.grades.map((grade) => grade.name)).toEqual(['3. ročník', '9. ročník'])
  })

  it('přejmenuje téma', async () => {
    const { topicId } = await seedTopic({ topic: 'Stare jmeno' })
    expect((await rename({ kind: 'topic', id: topicId, name: 'Nové jméno' })).status).toBe(200)
    const [row] = await db.select().from(topics).where(eq(topics.id, topicId))
    expect(row?.name).toBe('Nové jméno')
  })

  it('odmítne dva předměty téhož jména', async () => {
    const { subjectId } = await seedTopic({ subject: 'Chemie' })
    await create({ kind: 'subject', name: 'Zeměpis světa' })

    const { status, body } = await rename({ kind: 'subject', id: subjectId, name: 'Zeměpis světa' })
    expect(status).toBe(409)
    expect(body.error).toContain('Zeměpis světa')

    const [row] = await db.select().from(subjects).where(eq(subjects.id, subjectId))
    expect(row?.name).toBe('Chemie')
  })

  it('odmítne dva ročníky téhož jména v jednom předmětu a poradí, co s tím', async () => {
    const { subjectId, gradeId } = await seedTopic({ grade: '6. ročník' })
    await create({ kind: 'grade', name: '7. ročník', parentId: subjectId })

    const { status, body } = await rename({ kind: 'grade', id: gradeId, name: '7. ročník' })
    expect(status).toBe(409)
    expect(body.error).toContain('Upravit téma')
  })

  it('odmítne dvě témata téhož jména v ročníku a nabídne sloučení', async () => {
    const { gradeId, topicId } = await seedTopic({ topic: 'Savci' })
    await create({ kind: 'topic', name: 'Ptáci', parentId: gradeId })

    const { status, body } = await rename({ kind: 'topic', id: topicId, name: 'Ptáci' })
    expect(status).toBe(409)
    expect(body.error).toContain('Sloučit do jiného tématu')
  })

  it('přejmenování na tentýž název projde', async () => {
    const { subjectId } = await seedTopic({ subject: 'Beze změny' })
    expect((await rename({ kind: 'subject', id: subjectId, name: 'Beze změny' })).status).toBe(200)
  })

  it('neexistující položka je 404 a prázdný název 400', async () => {
    expect((await rename({ kind: 'topic', id: 'neexistuje', name: 'Cokoli' })).status).toBe(404)
    const { subjectId } = await seedTopic()
    expect((await rename({ kind: 'subject', id: subjectId, name: '  ' })).status).toBe(400)
  })
})
