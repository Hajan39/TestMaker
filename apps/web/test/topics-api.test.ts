import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { GET, PATCH, POST, PUT } from '@/app/api/topics/route'
import { db, grades, materials, questions, topics } from '@/db'
import { jsonReq, req, seedMaterial, seedQuestion, seedTopic, ACCOUNT } from './helpers'

/**
 * Group management: renaming, moving to a grade, moving a material and merging
 * topics. All of it moves data across the library — a bug shows only when a
 * material or questions disappear.
 */

async function topicRow(id: string) {
  const [row] = await db.select().from(topics).where(eq(topics.id, id)).limit(1)
  return row
}

async function materialRow(id: string) {
  const [row] = await db.select().from(materials).where(eq(materials.id, id)).limit(1)
  return row
}

async function questionRow(id: string) {
  const [row] = await db.select().from(questions).where(eq(questions.id, id)).limit(1)
  return row
}

describe('options for managing a group', () => {
  it('returns the other topics of the same grade, not itself', async () => {
    const { gradeId, topicId } = await seedTopic({ topic: 'Savci' })
    const neighborId = crypto.randomUUID()
    await db.insert(topics).values({ id: neighborId, schoolId: ACCOUNT.schoolId, gradeId, name: 'Ptáci' })

    const response = await GET(req(`/api/topics?siblingsOf=${topicId}`))
    const body = (await response.json()) as { topics: { id: string }[] }
    expect(body.topics.map((row) => row.id)).toEqual([neighborId])
  })

  it('returns the grades of the same subject', async () => {
    const { subjectId, topicId } = await seedTopic({ grade: '8. ročník' })
    await db.insert(grades).values({ id: crypto.randomUUID(), schoolId: ACCOUNT.schoolId, subjectId, name: '9. ročník' })

    const response = await GET(req(`/api/topics?gradesOf=${topicId}`))
    const body = (await response.json()) as { grades: { name: string }[]; currentGrade: string }
    expect(body.grades.map((row) => row.name).sort()).toEqual(['8. ročník', '9. ročník'])
    expect(body.currentGrade).toBe('8. ročník')
  })

  it('without a parameter returns empty, not an error', async () => {
    const response = await GET(req('/api/topics'))
    await expect(response.json()).resolves.toEqual({ topics: [], grades: [] })
  })
})

describe('renaming and moving a group', () => {
  it('renames a topic', async () => {
    const { topicId } = await seedTopic({ topic: 'Původní' })
    const response = await PATCH(jsonReq('/api/topics', 'PATCH', { id: topicId, name: '  Nový název  ' }))
    expect(response.status).toBe(200)
    expect((await topicRow(topicId))?.name).toBe('Nový název')
  })

  it("moves a topic to a grade that doesn't exist yet and creates it", async () => {
    const { subjectId, gradeId, topicId } = await seedTopic({ grade: '8. ročník' })
    const response = await PATCH(jsonReq('/api/topics', 'PATCH', { id: topicId, gradeName: '9. ročník' }))
    expect(response.status).toBe(200)

    const newItem = (await topicRow(topicId))!.gradeId
    expect(newItem).not.toBe(gradeId)
    const [grade] = await db.select().from(grades).where(eq(grades.id, newItem)).limit(1)
    expect(grade).toMatchObject({ subjectId, name: '9. ročník' })
  })

  it("doesn't create a second grade for an existing one in the same subject", async () => {
    const { subjectId, topicId } = await seedTopic({ grade: '8. ročník' })
    const targetId = crypto.randomUUID()
    await db.insert(grades).values({ id: targetId, schoolId: ACCOUNT.schoolId, subjectId, name: '9. ročník' })

    await PATCH(jsonReq('/api/topics', 'PATCH', { id: topicId, gradeName: '9. ročník' }))

    expect((await topicRow(topicId))?.gradeId).toBe(targetId)
    const all = await db.select().from(grades).where(eq(grades.subjectId, subjectId))
    expect(all).toHaveLength(2)
  })

  it('an unknown topic when changing grade is 404', async () => {
    const response = await PATCH(jsonReq('/api/topics', 'PATCH', { id: 'nic', gradeName: '9. ročník' }))
    expect(response.status).toBe(404)
  })

  it('a request that changes nothing is 400', async () => {
    const { topicId } = await seedTopic()
    const response = await PATCH(jsonReq('/api/topics', 'PATCH', { id: topicId }))
    expect(response.status).toBe(400)
  })
})

describe('moving a material to another group', () => {
  it('the material moves and both topics get their text volume recomputed', async () => {
    const { gradeId, topicId } = await seedTopic()
    const targetId = crypto.randomUUID()
    await db.insert(topics).values({ id: targetId, schoolId: ACCOUNT.schoolId, gradeId, name: 'Cílové téma' })
    const text = 'Text materiálu o savcích. '.repeat(60)
    const materialId = await seedMaterial(topicId, { text })
    // The volumes match the state before the move.
    await db.update(topics).set({ usableCharCount: text.length }).where(eq(topics.id, topicId))

    const response = await PUT(jsonReq('/api/topics', 'PUT', { materialId, topicId: targetId }))
    expect(response.status).toBe(200)

    expect((await materialRow(materialId))?.topicId).toBe(targetId)
    expect((await topicRow(topicId))?.usableCharCount).toBe(0)
    expect((await topicRow(targetId))?.usableCharCount).toBe(text.length)
  })

  it('the same content in the target group refuses the move with a Czech message, not a database error', async () => {
    const { gradeId, topicId } = await seedTopic()
    const targetId = crypto.randomUUID()
    await db.insert(topics).values({ id: targetId, schoolId: ACCOUNT.schoolId, gradeId, name: 'Cíl s týmž obsahem' })
    const materialId = await seedMaterial(topicId)
    const hash = (await materialRow(materialId))!.contentHash
    const duplicateId = await seedMaterial(targetId)
    await db.update(materials).set({ contentHash: hash }).where(eq(materials.id, duplicateId))

    const response = await PUT(jsonReq('/api/topics', 'PUT', { materialId, topicId: targetId }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('už v cílové skupině je')
    // The material stayed where it was.
    expect((await materialRow(materialId))?.topicId).toBe(topicId)
  })

  it('links to the moved material as an original are dropped so generation skips nothing', async () => {
    const { gradeId, topicId } = await seedTopic()
    const targetId = crypto.randomUUID()
    await db.insert(topics).values({ id: targetId, schoolId: ACCOUNT.schoolId, gradeId, name: 'Jiné téma' })
    const originalId = await seedMaterial(topicId, { fileName: 'Originál.docx' })
    const copyId = await seedMaterial(topicId, { fileName: 'Kopie.pdf' })
    await db
      .update(materials)
      .set({ duplicateOfId: originalId, duplicateScore: 0.9 })
      .where(eq(materials.id, copyId))

    await PUT(jsonReq('/api/topics', 'PUT', { materialId: originalId, topicId: targetId }))

    expect((await materialRow(copyId))?.duplicateOfId).toBeNull()
    expect((await materialRow(copyId))?.duplicateScore).toBeNull()
  })

  it('questions generated from the material go with it, approved ones included', async () => {
    const { gradeId, topicId } = await seedTopic()
    const targetId = crypto.randomUUID()
    await db.insert(topics).values({ id: targetId, schoolId: ACCOUNT.schoolId, gradeId, name: 'Nové téma' })
    const materialId = await seedMaterial(topicId, { fileName: 'Savci.pdf' })
    const questionId = await seedQuestion(topicId, { prompt: 'Čím krmí savci mláďata?', status: 'approved' })
    await db.update(questions).set({ materialId }).where(eq(questions.id, questionId))
    // A question without a material link — e.g. hand-written — stays in the topic.
    const foreignId = await seedQuestion(topicId, { prompt: 'Otázka odjinud' })

    await PUT(jsonReq('/api/topics', 'PUT', { materialId, topicId: targetId }))

    expect((await questionRow(questionId))?.topicId).toBe(targetId)
    expect((await questionRow(foreignId))?.topicId).toBe(topicId)
  })

  it('questions from a same-named material in another topic stay where they are', async () => {
    const { gradeId, topicId } = await seedTopic()
    const targetId = crypto.randomUUID()
    const otherId = crypto.randomUUID()
    await db.insert(topics).values([
      { id: targetId, schoolId: ACCOUNT.schoolId, gradeId, name: 'Cíl' },
      { id: otherId, schoolId: ACCOUNT.schoolId, gradeId, name: 'Nedotčené téma' },
    ])
    const materialId = await seedMaterial(topicId, { fileName: 'Savci.pdf' })
    // The question points at the moved material but hangs in a completely
    // different topic (left over from an older move). A foreign topic must not change.
    const foreignId = await seedQuestion(otherId)
    await db.update(questions).set({ materialId }).where(eq(questions.id, foreignId))

    await PUT(jsonReq('/api/topics', 'PUT', { materialId, topicId: targetId }))

    expect((await questionRow(foreignId))?.topicId).toBe(otherId)
  })

  it('an unknown material is 404', async () => {
    const { topicId } = await seedTopic()
    const response = await PUT(jsonReq('/api/topics', 'PUT', { materialId: 'nic', topicId }))
    expect(response.status).toBe(404)
  })

  it("doesn't move a material into a topic outside my school (or a missing one)", async () => {
    const { topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId)
    const response = await PUT(jsonReq('/api/topics', 'PUT', { materialId, topicId: 'cizi-tema' }))
    expect(response.status).toBe(404)
    expect((await materialRow(materialId))?.topicId).toBe(topicId)
  })
})

describe('merging groups', () => {
  it('moves materials and questions and deletes the original topic', async () => {
    const { gradeId, topicId: sourceId } = await seedTopic({ topic: 'Zdroj' })
    const targetId = crypto.randomUUID()
    await db.insert(topics).values({ id: targetId, schoolId: ACCOUNT.schoolId, gradeId, name: 'Cíl' })
    const materialId = await seedMaterial(sourceId, { fileName: 'Zdroj.docx' })
    const questionId = await seedQuestion(sourceId)

    const response = await POST(jsonReq('/api/topics', 'POST', { sourceId: sourceId, targetId: targetId }))
    expect(response.status).toBe(200)

    expect((await materialRow(materialId))?.topicId).toBe(targetId)
    const [question] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1)
    expect(question?.topicId).toBe(targetId)
    expect(await topicRow(sourceId)).toBeUndefined()
  })

  it("doesn't merge into a topic outside my school and leaves the source alone", async () => {
    const { topicId: sourceId } = await seedTopic({ topic: 'Zdroj bez cíle' })
    const materialId = await seedMaterial(sourceId)
    const response = await POST(jsonReq('/api/topics', 'POST', { sourceId: sourceId, targetId: 'cizi-tema' }))
    expect(response.status).toBe(404)
    expect((await materialRow(materialId))?.topicId).toBe(sourceId)
    expect(await topicRow(sourceId)).toBeDefined()
  })

  it('content the target group already has is dropped — it may be in a topic only once', async () => {
    const { gradeId, topicId: sourceId } = await seedTopic({ topic: 'Zdroj se shodou' })
    const targetId = crypto.randomUUID()
    await db.insert(topics).values({ id: targetId, schoolId: ACCOUNT.schoolId, gradeId, name: 'Cíl se shodou' })

    const targetMaterialId = await seedMaterial(targetId, { fileName: 'Společný.docx' })
    const hash = (await materialRow(targetMaterialId))!.contentHash
    const sourceMaterialId = await seedMaterial(sourceId, { fileName: 'Společný kopie.docx' })
    await db.update(materials).set({ contentHash: hash }).where(eq(materials.id, sourceMaterialId))
    const otherId = await seedMaterial(sourceId, { fileName: 'Navíc.docx' })

    const response = await POST(jsonReq('/api/topics', 'POST', { sourceId: sourceId, targetId: targetId }))
    expect(response.status).toBe(200)

    expect(await materialRow(sourceMaterialId)).toBeUndefined()
    expect((await materialRow(otherId))?.topicId).toBe(targetId)
    const inTarget = await db.select().from(materials).where(eq(materials.topicId, targetId))
    expect(inTarget).toHaveLength(2)
  })

  it('merging a topic with itself is 400', async () => {
    const { topicId } = await seedTopic()
    const response = await POST(jsonReq('/api/topics', 'POST', { sourceId: topicId, targetId: topicId }))
    expect(response.status).toBe(400)
  })
})
