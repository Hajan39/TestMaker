import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { GET, PATCH, POST, PUT } from '@/app/api/topics/route'
import { db, grades, materials, questions, topics } from '@/db'
import { jsonReq, req, seedMaterial, seedQuestion, seedTopic } from './helpers'

/**
 * Správa skupin: přejmenování, přeřazení do ročníku, přesun materiálu a
 * sloučení témat. Všechno to hýbe daty napříč knihovnou — chyba se pozná až
 * tím, že materiál nebo otázky zmizí.
 */

async function topicRow(id: string) {
  const [row] = await db.select().from(topics).where(eq(topics.id, id)).limit(1)
  return row
}

async function materialRow(id: string) {
  const [row] = await db.select().from(materials).where(eq(materials.id, id)).limit(1)
  return row
}

describe('nabídky pro správu skupiny', () => {
  it('vrátí ostatní témata téhož ročníku, sebe ne', async () => {
    const { gradeId, topicId } = await seedTopic({ topic: 'Savci' })
    const sousedId = crypto.randomUUID()
    await db.insert(topics).values({ id: sousedId, gradeId, name: 'Ptáci' })

    const response = await GET(req(`/api/topics?siblingsOf=${topicId}`))
    const body = (await response.json()) as { topics: { id: string }[] }
    expect(body.topics.map((row) => row.id)).toEqual([sousedId])
  })

  it('vrátí ročníky téhož předmětu', async () => {
    const { subjectId, topicId } = await seedTopic({ grade: '8. ročník' })
    await db.insert(grades).values({ id: crypto.randomUUID(), subjectId, name: '9. ročník' })

    const response = await GET(req(`/api/topics?gradesOf=${topicId}`))
    const body = (await response.json()) as { grades: { name: string }[]; currentGrade: string }
    expect(body.grades.map((row) => row.name).sort()).toEqual(['8. ročník', '9. ročník'])
    expect(body.currentGrade).toBe('8. ročník')
  })

  it('bez parametru vrátí prázdno, ne chybu', async () => {
    const response = await GET(req('/api/topics'))
    await expect(response.json()).resolves.toEqual({ topics: [], grades: [] })
  })
})

describe('přejmenování a přeřazení skupiny', () => {
  it('přejmenuje téma', async () => {
    const { topicId } = await seedTopic({ topic: 'Původní' })
    const response = await PATCH(jsonReq('/api/topics', 'PATCH', { id: topicId, name: '  Nový název  ' }))
    expect(response.status).toBe(200)
    expect((await topicRow(topicId))?.name).toBe('Nový název')
  })

  it('přeřadí téma do ročníku, který ještě není, a založí ho', async () => {
    const { subjectId, gradeId, topicId } = await seedTopic({ grade: '8. ročník' })
    const response = await PATCH(jsonReq('/api/topics', 'PATCH', { id: topicId, gradeName: '9. ročník' }))
    expect(response.status).toBe(200)

    const novy = (await topicRow(topicId))!.gradeId
    expect(novy).not.toBe(gradeId)
    const [grade] = await db.select().from(grades).where(eq(grades.id, novy)).limit(1)
    expect(grade).toMatchObject({ subjectId, name: '9. ročník' })
  })

  it('do existujícího ročníku téhož předmětu nezaloží druhý', async () => {
    const { subjectId, topicId } = await seedTopic({ grade: '8. ročník' })
    const cilId = crypto.randomUUID()
    await db.insert(grades).values({ id: cilId, subjectId, name: '9. ročník' })

    await PATCH(jsonReq('/api/topics', 'PATCH', { id: topicId, gradeName: '9. ročník' }))

    expect((await topicRow(topicId))?.gradeId).toBe(cilId)
    const vsechny = await db.select().from(grades).where(eq(grades.subjectId, subjectId))
    expect(vsechny).toHaveLength(2)
  })

  it('neznámé téma při změně ročníku je 404', async () => {
    const response = await PATCH(jsonReq('/api/topics', 'PATCH', { id: 'nic', gradeName: '9. ročník' }))
    expect(response.status).toBe(404)
  })

  it('požadavek, který nic nemění, je 400', async () => {
    const { topicId } = await seedTopic()
    const response = await PATCH(jsonReq('/api/topics', 'PATCH', { id: topicId }))
    expect(response.status).toBe(400)
  })
})

describe('přesun materiálu do jiné skupiny', () => {
  it('materiál se přesune a oběma tématům se přepočte objem textu', async () => {
    const { gradeId, topicId } = await seedTopic()
    const cilId = crypto.randomUUID()
    await db.insert(topics).values({ id: cilId, gradeId, name: 'Cílové téma' })
    const text = 'Text materiálu o savcích. '.repeat(60)
    const materialId = await seedMaterial(topicId, { text })
    // Objemy odpovídají stavu před přesunem.
    await db.update(topics).set({ usableCharCount: text.length }).where(eq(topics.id, topicId))

    const response = await PUT(jsonReq('/api/topics', 'PUT', { materialId, topicId: cilId }))
    expect(response.status).toBe(200)

    expect((await materialRow(materialId))?.topicId).toBe(cilId)
    expect((await topicRow(topicId))?.usableCharCount).toBe(0)
    expect((await topicRow(cilId))?.usableCharCount).toBe(text.length)
  })

  it('tentýž obsah v cílové skupině přesun odmítne českou hláškou, ne chybou databáze', async () => {
    const { gradeId, topicId } = await seedTopic()
    const cilId = crypto.randomUUID()
    await db.insert(topics).values({ id: cilId, gradeId, name: 'Cíl s týmž obsahem' })
    const materialId = await seedMaterial(topicId)
    const hash = (await materialRow(materialId))!.contentHash
    const dvojnikId = await seedMaterial(cilId)
    await db.update(materials).set({ contentHash: hash }).where(eq(materials.id, dvojnikId))

    const response = await PUT(jsonReq('/api/topics', 'PUT', { materialId, topicId: cilId }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('už v cílové skupině je')
    // Materiál zůstal, kde byl.
    expect((await materialRow(materialId))?.topicId).toBe(topicId)
  })

  it('odkazy na přesunutý materiál jako na originál se ruší, ať se generování nic nevynechává', async () => {
    const { gradeId, topicId } = await seedTopic()
    const cilId = crypto.randomUUID()
    await db.insert(topics).values({ id: cilId, gradeId, name: 'Jiné téma' })
    const originalId = await seedMaterial(topicId, { fileName: 'Originál.docx' })
    const kopieId = await seedMaterial(topicId, { fileName: 'Kopie.pdf' })
    await db
      .update(materials)
      .set({ duplicateOfId: originalId, duplicateScore: 0.9 })
      .where(eq(materials.id, kopieId))

    await PUT(jsonReq('/api/topics', 'PUT', { materialId: originalId, topicId: cilId }))

    expect((await materialRow(kopieId))?.duplicateOfId).toBeNull()
    expect((await materialRow(kopieId))?.duplicateScore).toBeNull()
  })

  it('neznámý materiál je 404', async () => {
    const { topicId } = await seedTopic()
    const response = await PUT(jsonReq('/api/topics', 'PUT', { materialId: 'nic', topicId }))
    expect(response.status).toBe(404)
  })
})

describe('sloučení skupin', () => {
  it('přesune materiály i otázky a původní téma smaže', async () => {
    const { gradeId, topicId: zdrojId } = await seedTopic({ topic: 'Zdroj' })
    const cilId = crypto.randomUUID()
    await db.insert(topics).values({ id: cilId, gradeId, name: 'Cíl' })
    const materialId = await seedMaterial(zdrojId, { fileName: 'Zdroj.docx' })
    const otazkaId = await seedQuestion(zdrojId)

    const response = await POST(jsonReq('/api/topics', 'POST', { sourceId: zdrojId, targetId: cilId }))
    expect(response.status).toBe(200)

    expect((await materialRow(materialId))?.topicId).toBe(cilId)
    const [otazka] = await db.select().from(questions).where(eq(questions.id, otazkaId)).limit(1)
    expect(otazka?.topicId).toBe(cilId)
    expect(await topicRow(zdrojId)).toBeUndefined()
  })

  it('obsah, který cílová skupina už má, se zahodí — v tématu smí být jen jednou', async () => {
    const { gradeId, topicId: zdrojId } = await seedTopic({ topic: 'Zdroj se shodou' })
    const cilId = crypto.randomUUID()
    await db.insert(topics).values({ id: cilId, gradeId, name: 'Cíl se shodou' })

    const cilMaterialId = await seedMaterial(cilId, { fileName: 'Společný.docx' })
    const hash = (await materialRow(cilMaterialId))!.contentHash
    const zdrojMaterialId = await seedMaterial(zdrojId, { fileName: 'Společný kopie.docx' })
    await db.update(materials).set({ contentHash: hash }).where(eq(materials.id, zdrojMaterialId))
    const jinyId = await seedMaterial(zdrojId, { fileName: 'Navíc.docx' })

    const response = await POST(jsonReq('/api/topics', 'POST', { sourceId: zdrojId, targetId: cilId }))
    expect(response.status).toBe(200)

    expect(await materialRow(zdrojMaterialId)).toBeUndefined()
    expect((await materialRow(jinyId))?.topicId).toBe(cilId)
    const vCili = await db.select().from(materials).where(eq(materials.topicId, cilId))
    expect(vCili).toHaveLength(2)
  })

  it('sloučení tématu se sebou samým je 400', async () => {
    const { topicId } = await seedTopic()
    const response = await POST(jsonReq('/api/topics', 'POST', { sourceId: topicId, targetId: topicId }))
    expect(response.status).toBe(400)
  })
})
