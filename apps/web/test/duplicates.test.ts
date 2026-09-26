import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db, materials, MIN_USABLE_TOPIC_CHARS, topics } from '@/db'
import { linkDuplicates, recomputeTopicContent } from '@/lib/duplicates'
import { seedMaterial, seedTopic, UCET } from './helpers'

/** Text delší než hranice použitelnosti, aby téma nebylo „málo obsahu“. */
const LONG_TEXT = 'Fotosyntéza probíhá v chloroplastech zelených rostlin. '.repeat(40)

async function materialRow(id: string) {
  const [row] = await db.select().from(materials).where(eq(materials.id, id)).limit(1)
  return row
}

async function topicRow(id: string) {
  const [row] = await db.select().from(topics).where(eq(topics.id, id)).limit(1)
  return row
}

describe('rozpoznání duplicit', () => {
  it('tentýž obsah v jiném formátu označí za duplicitu a nechá lepší formát', async () => {
    const { topicId } = await seedTopic()
    const docx = await seedMaterial(topicId, { fileName: 'Fotosyntéza.docx', text: LONG_TEXT })
    const pdf = await seedMaterial(topicId, { fileName: 'Fotosyntéza.pdf', text: LONG_TEXT })

    const link = await linkDuplicates(UCET, pdf)

    // Prezentace a textové dokumenty nesou víc než PDF vytištěné z nich.
    expect(link.duplicateOfId).toBe(docx)
    expect(link.score).toBeGreaterThanOrEqual(0.6)
    expect((await materialRow(pdf))?.duplicateOfId).toBe(docx)
    expect((await materialRow(docx))?.duplicateOfId).toBeNull()
  })

  it('když je nový materiál ten lepší, odsune se ten starý', async () => {
    const { topicId } = await seedTopic()
    const pdf = await seedMaterial(topicId, { fileName: 'Dýchání.pdf', text: LONG_TEXT })
    const docx = await seedMaterial(topicId, { fileName: 'Dýchání.docx', text: LONG_TEXT })

    const link = await linkDuplicates(UCET, docx)

    // Nově přidaný materiál duplicitou není — odsunul se ten původní.
    expect(link.duplicateOfId).toBeNull()
    expect((await materialRow(pdf))?.duplicateOfId).toBe(docx)
    expect((await materialRow(docx))?.duplicateOfId).toBeNull()
  })

  it('různý obsah spolu nespojuje', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Fotosyntéza.docx', text: LONG_TEXT })
    const jiny = await seedMaterial(topicId, {
      fileName: 'Savci.docx',
      text: 'Savci jsou teplokrevní obratlovci, kteří kojí mláďata mlékem. '.repeat(40),
    })

    expect(await linkDuplicates(UCET, jiny)).toEqual({ duplicateOfId: null, score: null })
    expect((await materialRow(jiny))?.duplicateOfId).toBeNull()
  })

  it('stejný obsah v jiném tématu duplicitou není', async () => {
    const prvni = await seedTopic()
    const druhe = await seedTopic()
    await seedMaterial(prvni.topicId, { fileName: 'Fotosyntéza.docx', text: LONG_TEXT })
    const jinde = await seedMaterial(druhe.topicId, { fileName: 'Fotosyntéza.pdf', text: LONG_TEXT })

    expect((await linkDuplicates(UCET, jinde)).duplicateOfId).toBeNull()
  })

  it('materiály ukazující na odsunutý originál se přepnou na vítěze', async () => {
    const { topicId } = await seedTopic()
    const pdf = await seedMaterial(topicId, { fileName: 'Voda.pdf', text: LONG_TEXT })
    const docx = await seedMaterial(topicId, { fileName: 'Voda.docx', text: LONG_TEXT })
    await linkDuplicates(UCET, docx)
    expect((await materialRow(pdf))?.duplicateOfId).toBe(docx)

    // Přijde prezentace — ta má přednost před vším ostatním.
    const odp = await seedMaterial(topicId, { fileName: 'Voda.odp', text: LONG_TEXT })
    await linkDuplicates(UCET, odp)

    expect((await materialRow(docx))?.duplicateOfId).toBe(odp)
    // Řetěz se nesmí zacyklit přes zrušený originál — PDF teď ukazuje na prezentaci.
    expect((await materialRow(pdf))?.duplicateOfId).toBe(odp)
  })

  it('neznámý materiál nic nerozbije', async () => {
    expect(await linkDuplicates(UCET, 'neexistuje')).toEqual({ duplicateOfId: null, score: null })
  })

  it('ručně vyřazený materiál se nestane vybraným originálem — nová verze zůstává použitelná', async () => {
    const { topicId } = await seedTopic()
    // Prezentace (.odp) má vyšší přednost formátu než PDF, takže by ji
    // `preferredMaterial` normálně vybral jako „ponechaný originál“ — přesto
    // je ale ručně vyřazená z generování. Bez opravy by nově nahrané PDF
    // skončilo jako duplicita něčeho nepoužitelného a z tématu by nešlo
    // vygenerovat nic.
    const odp = await seedMaterial(topicId, { fileName: 'Buňka.odp', text: LONG_TEXT, excluded: true })
    const pdf = await seedMaterial(topicId, { fileName: 'Buňka.pdf', text: LONG_TEXT })

    const link = await linkDuplicates(UCET, pdf)

    expect(link.duplicateOfId).toBeNull()
    expect((await materialRow(pdf))?.duplicateOfId).toBeNull()
    expect((await materialRow(odp))?.duplicateOfId).toBeNull()
  })
})

describe('přepočet stavu tématu', () => {
  it('sečte použitelný text a téma s dostatkem obsahu neoznačí', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'A.docx', text: LONG_TEXT })

    await recomputeTopicContent(UCET, topicId)

    const topic = await topicRow(topicId)
    expect(topic?.usableCharCount).toBe(LONG_TEXT.length)
    expect(topic?.lowContent).toBe(false)
  })

  it('duplicitu do součtu nepočítá', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Fotosyntéza.docx', text: LONG_TEXT })
    const pdf = await seedMaterial(topicId, { fileName: 'Fotosyntéza.pdf', text: LONG_TEXT })

    await recomputeTopicContent(UCET, topicId)
    expect((await topicRow(topicId))?.usableCharCount).toBe(LONG_TEXT.length * 2)

    await linkDuplicates(UCET, pdf)
    await recomputeTopicContent(UCET, topicId)

    // Po označení duplicity se stejný text nepočítá dvakrát.
    expect((await topicRow(topicId))?.usableCharCount).toBe(LONG_TEXT.length)
  })

  it('téma s málo textem označí jako nedostatečné', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Krátké.txt', text: 'Pár vět, na písemku to nestačí.' })

    await recomputeTopicContent(UCET, topicId)

    const topic = await topicRow(topicId)
    expect(topic!.usableCharCount).toBeLessThan(MIN_USABLE_TOPIC_CHARS)
    expect(topic?.lowContent).toBe(true)
  })

  it('téma bez materiálů má nulu a je označené', async () => {
    const { topicId } = await seedTopic()
    await recomputeTopicContent(UCET, topicId)

    const topic = await topicRow(topicId)
    expect(topic?.usableCharCount).toBe(0)
    expect(topic?.lowContent).toBe(true)
  })

  it('po smazání materiálu součet klesne', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'A.docx', text: LONG_TEXT })
    const druhy = await seedMaterial(topicId, {
      fileName: 'B.docx',
      text: 'Savci jsou teplokrevní obratlovci. '.repeat(40),
    })
    await recomputeTopicContent(UCET, topicId)
    const before = (await topicRow(topicId))!.usableCharCount

    await db.delete(materials).where(eq(materials.id, druhy))
    await recomputeTopicContent(UCET, topicId)

    expect((await topicRow(topicId))!.usableCharCount).toBeLessThan(before)
    expect((await topicRow(topicId))!.usableCharCount).toBe(LONG_TEXT.length)
  })
})
