import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db, materials, MIN_USABLE_TOPIC_CHARS, topics } from '@/db'
import { linkDuplicates, recomputeTopicContent } from '@/lib/duplicates'
import { seedMaterial, seedTopic, ACCOUNT } from './helpers'

/** Text longer than the usability threshold, so the topic isn't "low content". */
const LONG_TEXT = 'Fotosyntéza probíhá v chloroplastech zelených rostlin. '.repeat(40)

async function materialRow(id: string) {
  const [row] = await db.select().from(materials).where(eq(materials.id, id)).limit(1)
  return row
}

async function topicRow(id: string) {
  const [row] = await db.select().from(topics).where(eq(topics.id, id)).limit(1)
  return row
}

describe('duplicate detection', () => {
  it('marks the same content in another format as a duplicate and keeps the better format', async () => {
    const { topicId } = await seedTopic()
    const docx = await seedMaterial(topicId, { fileName: 'Fotosyntéza.docx', text: LONG_TEXT })
    const pdf = await seedMaterial(topicId, { fileName: 'Fotosyntéza.pdf', text: LONG_TEXT })

    const link = await linkDuplicates(ACCOUNT, pdf)

    // Presentations and text documents carry more than PDFs printed from them.
    expect(link.duplicateOfId).toBe(docx)
    expect(link.score).toBeGreaterThanOrEqual(0.6)
    expect((await materialRow(pdf))?.duplicateOfId).toBe(docx)
    expect((await materialRow(docx))?.duplicateOfId).toBeNull()
  })

  it('demotes the old material when the new one is better', async () => {
    const { topicId } = await seedTopic()
    const pdf = await seedMaterial(topicId, { fileName: 'Dýchání.pdf', text: LONG_TEXT })
    const docx = await seedMaterial(topicId, { fileName: 'Dýchání.docx', text: LONG_TEXT })

    const link = await linkDuplicates(ACCOUNT, docx)

    // The newly added material isn't a duplicate — the original was demoted.
    expect(link.duplicateOfId).toBeNull()
    expect((await materialRow(pdf))?.duplicateOfId).toBe(docx)
    expect((await materialRow(docx))?.duplicateOfId).toBeNull()
  })

  it('does not link different content', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Fotosyntéza.docx', text: LONG_TEXT })
    const other = await seedMaterial(topicId, {
      fileName: 'Savci.docx',
      text: 'Savci jsou teplokrevní obratlovci, kteří kojí mláďata mlékem. '.repeat(40),
    })

    expect(await linkDuplicates(ACCOUNT, other)).toEqual({ duplicateOfId: null, score: null })
    expect((await materialRow(other))?.duplicateOfId).toBeNull()
  })

  it('the same content in another topic is not a duplicate', async () => {
    const first = await seedTopic()
    const second = await seedTopic()
    await seedMaterial(first.topicId, { fileName: 'Fotosyntéza.docx', text: LONG_TEXT })
    const elsewhere = await seedMaterial(second.topicId, { fileName: 'Fotosyntéza.pdf', text: LONG_TEXT })

    expect((await linkDuplicates(ACCOUNT, elsewhere)).duplicateOfId).toBeNull()
  })

  it('switches materials pointing at the demoted original to the winner', async () => {
    const { topicId } = await seedTopic()
    const pdf = await seedMaterial(topicId, { fileName: 'Voda.pdf', text: LONG_TEXT })
    const docx = await seedMaterial(topicId, { fileName: 'Voda.docx', text: LONG_TEXT })
    await linkDuplicates(ACCOUNT, docx)
    expect((await materialRow(pdf))?.duplicateOfId).toBe(docx)

    // A presentation arrives — it takes precedence over everything else.
    const odp = await seedMaterial(topicId, { fileName: 'Voda.odp', text: LONG_TEXT })
    await linkDuplicates(ACCOUNT, odp)

    expect((await materialRow(docx))?.duplicateOfId).toBe(odp)
    // The chain must not loop through the demoted original — the PDF now points at the presentation.
    expect((await materialRow(pdf))?.duplicateOfId).toBe(odp)
  })

  it('an unknown material breaks nothing', async () => {
    expect(await linkDuplicates(ACCOUNT, 'neexistuje')).toEqual({ duplicateOfId: null, score: null })
  })

  it('a manually excluded material never becomes the kept original — the new version stays usable', async () => {
    const { topicId } = await seedTopic()
    // A presentation (.odp) has a higher format priority than PDF, so
    // `preferredMaterial` would normally pick it as the "kept original" — yet
    // it is manually excluded from generation. Without the fix the newly
    // uploaded PDF would end up as a duplicate of something unusable and the
    // topic could not generate anything.
    const odp = await seedMaterial(topicId, { fileName: 'Buňka.odp', text: LONG_TEXT, excluded: true })
    const pdf = await seedMaterial(topicId, { fileName: 'Buňka.pdf', text: LONG_TEXT })

    const link = await linkDuplicates(ACCOUNT, pdf)

    expect(link.duplicateOfId).toBeNull()
    expect((await materialRow(pdf))?.duplicateOfId).toBeNull()
    expect((await materialRow(odp))?.duplicateOfId).toBeNull()
  })
})

describe('topic content recompute', () => {
  it('sums usable text and does not flag a topic with enough content', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'A.docx', text: LONG_TEXT })

    await recomputeTopicContent(ACCOUNT, topicId)

    const topic = await topicRow(topicId)
    expect(topic?.usableCharCount).toBe(LONG_TEXT.length)
    expect(topic?.lowContent).toBe(false)
  })

  it('does not count a duplicate in the sum', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Fotosyntéza.docx', text: LONG_TEXT })
    const pdf = await seedMaterial(topicId, { fileName: 'Fotosyntéza.pdf', text: LONG_TEXT })

    await recomputeTopicContent(ACCOUNT, topicId)
    expect((await topicRow(topicId))?.usableCharCount).toBe(LONG_TEXT.length * 2)

    await linkDuplicates(ACCOUNT, pdf)
    await recomputeTopicContent(ACCOUNT, topicId)

    // After marking the duplicate the same text isn't counted twice.
    expect((await topicRow(topicId))?.usableCharCount).toBe(LONG_TEXT.length)
  })

  it('flags a topic with little text as insufficient', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Krátké.txt', text: 'Pár vět, na písemku to nestačí.' })

    await recomputeTopicContent(ACCOUNT, topicId)

    const topic = await topicRow(topicId)
    expect(topic!.usableCharCount).toBeLessThan(MIN_USABLE_TOPIC_CHARS)
    expect(topic?.lowContent).toBe(true)
  })

  it('a topic without materials has zero and is flagged', async () => {
    const { topicId } = await seedTopic()
    await recomputeTopicContent(ACCOUNT, topicId)

    const topic = await topicRow(topicId)
    expect(topic?.usableCharCount).toBe(0)
    expect(topic?.lowContent).toBe(true)
  })

  it('the sum drops after a material is deleted', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'A.docx', text: LONG_TEXT })
    const second = await seedMaterial(topicId, {
      fileName: 'B.docx',
      text: 'Savci jsou teplokrevní obratlovci. '.repeat(40),
    })
    await recomputeTopicContent(ACCOUNT, topicId)
    const before = (await topicRow(topicId))!.usableCharCount

    await db.delete(materials).where(eq(materials.id, second))
    await recomputeTopicContent(ACCOUNT, topicId)

    expect((await topicRow(topicId))!.usableCharCount).toBeLessThan(before)
    expect((await topicRow(topicId))!.usableCharCount).toBe(LONG_TEXT.length)
  })
})
