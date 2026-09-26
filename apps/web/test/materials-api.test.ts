import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { ExtractedMaterial } from '@testmaker/core/schema'
import { POST, DELETE } from '@/app/api/materials/route'
import { db, materials, topics } from '@/db'
import { jsonReq, req, seedTopic } from './helpers'

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
})
