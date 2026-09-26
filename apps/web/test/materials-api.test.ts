import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtractedMaterial } from '@testmaker/core/schema'
import { POST, DELETE, PATCH } from '@/app/api/materials/route'
import { db, materials, schools, topics, users } from '@/db'
import { newId } from '@/lib/ids'
import { jsonReq, req, seedTopic, seedMaterial, seedUcet } from './helpers'

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Učitelka z jiné školy — cizí materiál pro ni nesmí existovat. */
async function ucitelkaJineSkoly(): Promise<string> {
  const schoolId = newId()
  await db.insert(schools).values({ id: schoolId, name: 'Jiná škola', slug: `jina-materialy-${schoolId}` })
  const userId = newId()
  await db.insert(users).values({
    id: userId,
    schoolId,
    email: `${userId}@localhost`,
    name: 'Cizí učitelka',
    role: 'ucitelka',
  })
  return userId
}

/**
 * Import materiálů. Tady se do knihovny dostávají data, takže chyba v téhle
 * cestě se projeví až tím, že učitelka nenajde soubor, který nahrála, nebo ho
 * najde dvakrát.
 */

/** Text dost dlouhý na to, aby téma nebylo označené jako „málo obsahu“. */
const TEXT = 'Krevní oběh rozvádí kyslík a živiny do celého těla. '.repeat(40)

let counter = 0

/** Materiál po extrakci textu — přesně to, co pošle prohlížeč. */
function extracted(options: Partial<ExtractedMaterial> = {}): ExtractedMaterial {
  counter += 1
  const fileName = options.fileName ?? `Soubor ${counter}.docx`
  const subject = options.subject ?? 'Přírodopis'
  const grade = options.grade === undefined ? '8. ročník' : options.grade
  const topic = options.topic ?? 'Oběhová soustava'
  return {
    relativePath: options.relativePath ?? `${subject}/${grade ?? ''}/${topic}/${fileName}`,
    fileName,
    subject,
    grade,
    topic,
    mimeType: options.mimeType ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: options.sizeBytes ?? 1024,
    text: options.text ?? TEXT,
    pageCount: options.pageCount ?? null,
    needsOcr: options.needsOcr ?? false,
    contentHash: options.contentHash ?? `obsah-hash-${counter}`,
  }
}

interface ImportResult {
  imported: number
  duplicates: number
  sameContent: number
  replaced: number
}

/** Import bez seskupování podobných témat — testy chtějí téma přesně podle názvu. */
async function importMaterials(items: ExtractedMaterial[], topicId?: string): Promise<ImportResult> {
  const response = await POST(
    jsonReq('/api/materials?group=0', 'POST', { materials: items, ...(topicId ? { topicId } : {}) }),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as ImportResult
}

async function rows(topicName: string) {
  const [topic] = await db.select().from(topics).where(eq(topics.name, topicName)).limit(1)
  if (!topic) return []
  return db.select().from(materials).where(eq(materials.topicId, topic.id))
}

describe('import materiálů', () => {
  it('založí celou cestu knihovnou a uloží text', async () => {
    const result = await importMaterials([extracted({ topic: 'Dýchací soustava' })])

    expect(result).toMatchObject({ imported: 1, duplicates: 0, replaced: 0 })
    const list = await rows('Dýchací soustava')
    expect(list).toHaveLength(1)
    expect(list[0]!.text).toBe(TEXT)
    expect(list[0]!.charCount).toBe(TEXT.length)

    // Použitelný objem textu se udržuje při importu, ať ho seznam témat nemusí počítat.
    const [topic] = await db.select().from(topics).where(eq(topics.id, list[0]!.topicId)).limit(1)
    expect(topic!.usableCharCount).toBe(TEXT.length)
    expect(topic!.lowContent).toBe(false)
  })

  it('tentýž soubor podruhé se nenaimportuje znovu', async () => {
    const material = extracted({ topic: 'Trávicí soustava' })
    await importMaterials([material])
    const result = await importMaterials([material])

    expect(result).toMatchObject({ imported: 0, duplicates: 1, replaced: 0 })
    expect(await rows('Trávicí soustava')).toHaveLength(1)
  })

  it('tentýž obsah pod jiným názvem je v jednom tématu taky duplicita', async () => {
    const hash = 'hash-stejny-obsah'
    await importMaterials([extracted({ topic: 'Kostra', contentHash: hash, fileName: 'Kostra.docx' })])
    const result = await importMaterials([
      extracted({ topic: 'Kostra', contentHash: hash, fileName: 'Kostra – kopie.docx' }),
    ])

    expect(result).toMatchObject({ imported: 0, duplicates: 1 })
    expect(await rows('Kostra')).toHaveLength(1)
  })

  it('tentýž obsah v jiném tématu duplicita není — pracovní list patří do obou', async () => {
    const hash = 'hash-pracovni-list'
    await importMaterials([
      extracted({ topic: 'Savci', grade: '7. ročník', contentHash: hash, fileName: 'List.docx' }),
    ])
    const result = await importMaterials([
      extracted({ topic: 'Savci opakování', grade: '8. ročník', contentHash: hash, fileName: 'List.docx' }),
    ])

    expect(result).toMatchObject({ imported: 1, duplicates: 0 })
    expect(await rows('Savci')).toHaveLength(1)
    expect(await rows('Savci opakování')).toHaveLength(1)
  })

  it('změněný soubor na téže cestě starou verzi nahradí, ne přidá', async () => {
    const path = 'Přírodopis/8. ročník/Buňka/Buňka.docx'
    await importMaterials([
      extracted({ topic: 'Buňka', relativePath: path, fileName: 'Buňka.docx', contentHash: 'hash-bunka-v1' }),
    ])
    const novyText = `${TEXT} Nově doplněná kapitola o jádru.`
    const result = await importMaterials([
      extracted({
        topic: 'Buňka',
        relativePath: path,
        fileName: 'Buňka.docx',
        contentHash: 'hash-bunka-v2',
        text: novyText,
      }),
    ])

    expect(result).toMatchObject({ imported: 1, replaced: 1, duplicates: 0 })
    const list = await rows('Buňka')
    expect(list).toHaveLength(1)
    expect(list[0]!.text).toBe(novyText)
    expect(list[0]!.contentHash).toBe('hash-bunka-v2')
  })

  it('re-nahrání změněné verze ručně vyřazeného souboru zachová vyřazení', async () => {
    const path = 'Přírodopis/8. ročník/List/List.docx'
    await importMaterials([
      extracted({ topic: 'List', relativePath: path, fileName: 'List.docx', contentHash: 'hash-list-v1' }),
    ])
    const puvodni = (await rows('List'))[0]!
    const vyrazeni = await PATCH(jsonReq('/api/materials', 'PATCH', { id: puvodni.id, excluded: true }))
    expect(vyrazeni.status).toBe(200)

    const result = await importMaterials([
      extracted({
        topic: 'List',
        relativePath: path,
        fileName: 'List.docx',
        contentHash: 'hash-list-v2',
        text: `${TEXT} Doplněná verze.`,
      }),
    ])

    expect(result).toMatchObject({ imported: 1, replaced: 1 })
    const list = await rows('List')
    expect(list).toHaveLength(1)
    expect(list[0]!.contentHash).toBe('hash-list-v2')
    expect(list[0]!.excluded).toBe(true)
  })

  it('stejný obsah v jiném formátu odloží jako duplicitní a do generování ho nepustí', async () => {
    const result = await importMaterials([
      extracted({ topic: 'Houby', fileName: 'Houby.docx', contentHash: 'hash-houby-docx' }),
      extracted({ topic: 'Houby', fileName: 'Houby.pdf', contentHash: 'hash-houby-pdf' }),
    ])

    expect(result.imported).toBe(2)
    expect(result.sameContent).toBe(1)

    const list = await rows('Houby')
    const pdf = list.find((row) => row.fileName === 'Houby.pdf')!
    const docx = list.find((row) => row.fileName === 'Houby.docx')!
    // PDF vytištěné z dokumentu je ten horší z dvojice.
    expect(pdf.duplicateOfId).toBe(docx.id)
    expect(docx.duplicateOfId).toBeNull()

    // Do použitelného objemu se duplicita nepočítá.
    const [topic] = await db.select().from(topics).where(eq(topics.id, docx.topicId)).limit(1)
    expect(topic!.usableCharCount).toBe(TEXT.length)
  })

  it('nesmyslná data jsou 400, ne pád serveru', async () => {
    const response = await POST(jsonReq('/api/materials', 'POST', { materials: [] }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Neplatná data' })
  })
})

describe('smazání materiálu', () => {
  it('materiál zmizí a objem textu tématu klesne', async () => {
    await importMaterials([extracted({ topic: 'Ptáci', fileName: 'Ptáci.docx' })])
    const [material] = await rows('Ptáci')

    const response = await DELETE(req(`/api/materials?id=${material!.id}`, { method: 'DELETE' }))
    expect(response.status).toBe(200)

    expect(await rows('Ptáci')).toHaveLength(0)
    const [topic] = await db.select().from(topics).where(eq(topics.id, material!.topicId)).limit(1)
    expect(topic!.usableCharCount).toBe(0)
    expect(topic!.lowContent).toBe(true)
  })

  it('bez id je to 400', async () => {
    const response = await DELETE(req('/api/materials', { method: 'DELETE' }))
    expect(response.status).toBe(400)
  })
})

describe('nahrání do zadaného tématu', () => {
  it('jde do tématu podle id, i když se mezitím přejmenovalo, a pole subject/grade/topic se ignorují', async () => {
    const { topicId } = await seedTopic({ topic: 'Původní název' })
    await db.update(topics).set({ name: 'Nový název' }).where(eq(topics.id, topicId))

    const result = await importMaterials(
      [extracted({ subject: 'Jiný předmět', grade: '9. ročník', topic: 'Úplně jiné téma' })],
      topicId,
    )

    expect(result).toMatchObject({ imported: 1, duplicates: 0 })
    const list = await db.select().from(materials).where(eq(materials.topicId, topicId))
    expect(list).toHaveLength(1)
    // Nemělo vzniknout žádné nové téma podle jmen z materiálu.
    expect(await rows('Úplně jiné téma')).toHaveLength(0)
  })

  it('cizí nebo neexistující téma je 404', async () => {
    const response = await POST(
      jsonReq('/api/materials?group=0', 'POST', {
        materials: [extracted()],
        topicId: 'neexistujici-id',
      }),
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'Téma se nenašlo' })
  })

  it('stejný hash podruhé do téhož zadaného tématu nevznikne dvakrát', async () => {
    const { topicId } = await seedTopic()
    const material = extracted({ contentHash: 'hash-do-tematu' })

    const first = await importMaterials([material], topicId)
    const second = await importMaterials([material], topicId)

    expect(first).toMatchObject({ imported: 1, duplicates: 0 })
    expect(second).toMatchObject({ imported: 0, duplicates: 1 })
    const list = await db.select().from(materials).where(eq(materials.topicId, topicId))
    expect(list).toHaveLength(1)
  })

  it('bez topicId chování zůstává jako dřív — téma se hledá/zakládá podle jmen', async () => {
    const result = await importMaterials([extracted({ topic: 'Beze změny' })])
    expect(result).toMatchObject({ imported: 1, duplicates: 0 })
    expect(await rows('Beze změny')).toHaveLength(1)
  })

  it('stejný název souboru se stejným obsahem do dvou různých témat je v obou', async () => {
    const soubor = extracted({ relativePath: 'Pracovní list.docx', fileName: 'Pracovní list.docx' })
    const { topicId: topicA } = await seedTopic({ topic: 'Téma A' })
    const { topicId: topicB } = await seedTopic({ topic: 'Téma B' })

    const first = await importMaterials([soubor], topicA)
    const second = await importMaterials([soubor], topicB)

    expect(first).toMatchObject({ imported: 1, duplicates: 0 })
    expect(second).toMatchObject({ imported: 1, duplicates: 0 })
    expect(await db.select().from(materials).where(eq(materials.topicId, topicA))).toHaveLength(1)
    expect(await db.select().from(materials).where(eq(materials.topicId, topicB))).toHaveLength(1)
  })

  it('stejný název souboru s jiným obsahem do jiného tématu nenahradí materiál v prvním tématu', async () => {
    const relativePath = 'Pracovní list.docx'
    const { topicId: topicA } = await seedTopic({ topic: 'Téma A2' })
    const { topicId: topicB } = await seedTopic({ topic: 'Téma B2' })

    await importMaterials(
      [extracted({ relativePath, fileName: relativePath, contentHash: 'hash-a-dlouhy', text: 'Obsah tématu A' })],
      topicA,
    )
    const result = await importMaterials(
      [extracted({ relativePath, fileName: relativePath, contentHash: 'hash-b-dlouhy', text: 'Obsah tématu B' })],
      topicB,
    )

    expect(result).toMatchObject({ imported: 1, replaced: 0, duplicates: 0 })
    const inA = await db.select().from(materials).where(eq(materials.topicId, topicA))
    const inB = await db.select().from(materials).where(eq(materials.topicId, topicB))
    expect(inA).toHaveLength(1)
    expect(inA[0]!.contentHash).toBe('hash-a-dlouhy')
    expect(inB).toHaveLength(1)
    expect(inB[0]!.contentHash).toBe('hash-b-dlouhy')
  })

  it('opětovné nahrání do téhož tématu s jiným obsahem pořád nahradí v tomtéž tématu', async () => {
    const relativePath = 'Pracovní list.docx'
    const { topicId } = await seedTopic({ topic: 'Téma C' })

    await importMaterials(
      [extracted({ relativePath, fileName: relativePath, contentHash: 'hash-v1-dlouhy', text: 'Verze jedna' })],
      topicId,
    )
    const result = await importMaterials(
      [extracted({ relativePath, fileName: relativePath, contentHash: 'hash-v2-dlouhy', text: 'Verze dva' })],
      topicId,
    )

    expect(result).toMatchObject({ imported: 1, replaced: 1, duplicates: 0 })
    const list = await db.select().from(materials).where(eq(materials.topicId, topicId))
    expect(list).toHaveLength(1)
    expect(list[0]!.contentHash).toBe('hash-v2-dlouhy')
  })
})

describe('vynechání materiálu z generování', () => {
  it('PATCH nastaví excluded a přepočte použitelný objem textu tématu', async () => {
    const { topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId, { text: TEXT })

    const response = await PATCH(jsonReq('/api/materials', 'PATCH', { id: materialId, excluded: true }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })

    const [material] = await db.select().from(materials).where(eq(materials.id, materialId)).limit(1)
    expect(material!.excluded).toBe(true)

    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1)
    expect(topic!.usableCharCount).toBe(0)
    expect(topic!.lowContent).toBe(true)
  })

  it('cizí materiál se tváří jako neexistující — 404', async () => {
    const { topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId)
    vi.stubEnv('E2E_UZIVATEL', await ucitelkaJineSkoly())

    const response = await PATCH(jsonReq('/api/materials', 'PATCH', { id: materialId, excluded: true }))
    expect(response.status).toBe(404)
  })

  it('náhled vynechávat nesmí — 403', async () => {
    const { topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId)
    vi.stubEnv('E2E_UZIVATEL', (await seedUcet({ role: 'nahled' })).userId)

    const response = await PATCH(jsonReq('/api/materials', 'PATCH', { id: materialId, excluded: true }))
    expect(response.status).toBe(403)
  })
})
