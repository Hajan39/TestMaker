import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DELETE, GET, POST } from '@/app/api/jobs/route'
import { db, generationJobs, materials, type GenerationJobParams } from '@/db'
import { newId } from '@/lib/ids'
import { jsonReq, req, seedMaterial, seedQuestion, seedTopic, UCET } from './helpers'

/**
 * Fronta hromadného generování. Zařazuje se z celé knihovny naráz, takže se tu
 * nejsnáz stane, že se téma zařadí dvakrát nebo se naopak nezařadí vůbec.
 */

interface EnqueueResult {
  enqueued: number
  skipped: number
}

async function enqueue(body: Record<string, unknown>): Promise<EnqueueResult> {
  const response = await POST(jsonReq('/api/jobs', 'POST', body))
  expect(response.status).toBe(200)
  return (await response.json()) as EnqueueResult
}

async function jobsOf(topicId: string) {
  return db.select().from(generationJobs).where(eq(generationJobs.topicId, topicId))
}

/** Téma s materiálem — bez textu se do fronty nezařazuje. */
async function topicWithMaterial(): Promise<string> {
  const { topicId } = await seedTopic()
  await seedMaterial(topicId)
  return topicId
}

describe('zařazení do fronty', () => {
  it('zařadí téma s materiálem a uloží k němu zadání', async () => {
    const topicId = await topicWithMaterial()

    const result = await enqueue({ topicIds: [topicId], count: 8, difficulty: 3, types: ['single_choice'] })

    expect(result).toMatchObject({ enqueued: 1, skipped: 0 })
    const [job] = await jobsOf(topicId)
    expect(job?.status).toBe('queued')
    expect(job?.params as GenerationJobParams).toMatchObject({
      count: 8,
      difficulty: 3,
      types: ['single_choice'],
      mode: 'add',
    })
  })

  it('téma bez materiálů se nezařadí — není z čeho generovat', async () => {
    const { topicId } = await seedTopic()
    const result = await enqueue({ topicIds: [topicId] })
    expect(result.enqueued).toBe(0)
    expect(await jobsOf(topicId)).toHaveLength(0)
  })

  it('téma, kde jsou jen duplicitní materiály, se nezařadí', async () => {
    const { topicId } = await seedTopic()
    const jinde = await seedTopic()
    const originalId = await seedMaterial(jinde.topicId, { fileName: 'Originál.docx' })
    const kopieId = await seedMaterial(topicId, { fileName: 'Kopie.pdf' })
    await db.update(materials).set({ duplicateOfId: originalId }).where(eq(materials.id, kopieId))

    const result = await enqueue({ topicIds: [topicId] })
    expect(result.enqueued).toBe(0)
  })

  it('téma, které už otázky má, se přeskočí', async () => {
    const topicId = await topicWithMaterial()
    await seedQuestion(topicId)

    const result = await enqueue({ topicIds: [topicId] })
    expect(result).toMatchObject({ enqueued: 0, skipped: 1 })
  })

  it('u doplňování se téma s otázkami nepřeskakuje — právě o něj jde', async () => {
    const topicId = await topicWithMaterial()
    await seedQuestion(topicId)

    const result = await enqueue({ topicIds: [topicId], mode: 'target', count: 20 })
    expect(result.enqueued).toBe(1)
    expect((await jobsOf(topicId))[0]?.params as GenerationJobParams).toMatchObject({ mode: 'target' })
  })

  it('téma, které už ve frontě čeká, se nezařadí podruhé', async () => {
    const topicId = await topicWithMaterial()
    await enqueue({ topicIds: [topicId] })

    const result = await enqueue({ topicIds: [topicId] })
    expect(result).toMatchObject({ enqueued: 0, skipped: 1 })
    expect(await jobsOf(topicId)).toHaveLength(1)
  })

  it('rozsahem může být celý ročník i celý předmět', async () => {
    const { subjectId, gradeId, topicId } = await seedTopic()
    await seedMaterial(topicId)

    expect(await enqueue({ gradeId })).toMatchObject({ enqueued: 1 })
    await db.delete(generationJobs).where(eq(generationJobs.topicId, topicId))
    expect(await enqueue({ subjectId })).toMatchObject({ enqueued: 1 })
  })

  it('bez rozsahu se nezařadí nic', async () => {
    expect(await enqueue({})).toMatchObject({ enqueued: 0, skipped: 0 })
  })

  it('nesmyslné zadání je 400', async () => {
    const response = await POST(jsonReq('/api/jobs', 'POST', { count: 999 }))
    expect(response.status).toBe(400)
  })
})

describe('stav a vyprázdnění fronty', () => {
  it('spočítá úlohy podle stavu', async () => {
    const { topicId } = await seedTopic()
    // Soubor testů sdílí jednu databázi — počítá se to, co je ve frontě teď.
    await db.delete(generationJobs)
    await db.insert(generationJobs).values([
      { id: newId(), schoolId: UCET.schoolId, requestedBy: UCET.userId, topicId, params: {} as GenerationJobParams, status: 'queued' },
      { id: newId(), schoolId: UCET.schoolId, requestedBy: UCET.userId, topicId, params: {} as GenerationJobParams, status: 'running' },
      { id: newId(), schoolId: UCET.schoolId, requestedBy: UCET.userId, topicId, params: {} as GenerationJobParams, status: 'done' },
      { id: newId(), schoolId: UCET.schoolId, requestedBy: UCET.userId, topicId, params: {} as GenerationJobParams, status: 'error' },
    ])

    const body = (await (await GET(req('/api/jobs'))).json()) as Record<string, number>
    expect(body).toMatchObject({ queued: 1, running: 1, done: 1, error: 1 })
  })

  it('vyprázdnění smaže i zaseknuté běžící úlohy, hotové nechá', async () => {
    const { topicId } = await seedTopic()
    await db.delete(generationJobs)
    await db.insert(generationJobs).values([
      { id: newId(), schoolId: UCET.schoolId, requestedBy: UCET.userId, topicId, params: {} as GenerationJobParams, status: 'queued' },
      { id: newId(), schoolId: UCET.schoolId, requestedBy: UCET.userId, topicId, params: {} as GenerationJobParams, status: 'running' },
      { id: newId(), schoolId: UCET.schoolId, requestedBy: UCET.userId, topicId, params: {} as GenerationJobParams, status: 'error' },
      { id: newId(), schoolId: UCET.schoolId, requestedBy: UCET.userId, topicId, params: {} as GenerationJobParams, status: 'done' },
    ])

    const body = (await (await DELETE(req('/api/jobs'))).json()) as { removed: number }
    expect(body.removed).toBe(3)
    const zbytek = await db.select().from(generationJobs)
    expect(zbytek.map((row) => row.status)).toEqual(['done'])
  })
})
