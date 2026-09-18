import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { DELETE, GET } from '@/app/api/jobs/route'
import { POST as RETRY } from '@/app/api/jobs/retry/route'
import { db, generationJobs, type GenerationJobParams } from '@/db'
import { newId } from '@/lib/ids'
import { jsonReq, req, seedTopic } from './helpers'

/**
 * Přehled generování. Učitelka z něj musí poznat, co běží, co čeká a co se
 * nepovedlo — a nedokončené téma musí jít zkusit znovu, aniž by se generoval
 * znovu celý ročník.
 */

const PARAMS: GenerationJobParams = { count: 8, types: ['single_choice'], difficulty: 2, mode: 'add' }

interface JobRow {
  id: string
  topicId: string
  topicName: string
  place: string
  status: string
  wanted: number | null
  createdCount: number
  error: string | null
  startedAt: string | null
}

/** Úloha nad novým tématem v zadaném stavu. */
async function seedJob(
  status: 'queued' | 'running' | 'done' | 'error',
  extra: { error?: string; producedCount?: number; startedAt?: string; topicId?: string } = {},
): Promise<{ jobId: string; topicId: string }> {
  const topicId = extra.topicId ?? (await seedTopic()).topicId
  const jobId = newId()
  await db.insert(generationJobs).values({
    id: jobId,
    topicId,
    params: PARAMS,
    status,
    error: extra.error ?? null,
    producedCount: extra.producedCount ?? 0,
    startedAt: extra.startedAt ?? null,
    finishedAt: status === 'done' || status === 'error' ? new Date().toISOString() : null,
  })
  return { jobId, topicId }
}

async function prehled(): Promise<{ jobs: JobRow[]; running: number; queued: number; error: number }> {
  const response = await GET(req('/api/jobs?vypis=1'))
  expect(response.status).toBe(200)
  return (await response.json()) as { jobs: JobRow[]; running: number; queued: number; error: number }
}

beforeEach(async () => {
  await db.delete(generationJobs)
})

describe('výpis fronty', () => {
  it('bez parametru vrací jen počty — ukazatel v liště se ptá často', async () => {
    await seedJob('queued')
    const body = (await (await GET(req('/api/jobs'))).json()) as Record<string, unknown>
    expect(body).toMatchObject({ queued: 1 })
    expect(body.jobs).toBeUndefined()
  })

  it('vypíše téma, kde se generuje, od kdy běží i kolik otázek mělo vzniknout', async () => {
    const zacatek = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { topicId } = await seedJob('running', { startedAt: zacatek })

    const { jobs, running } = await prehled()
    expect(running).toBe(1)
    const job = jobs.find((row) => row.topicId === topicId)
    expect(job?.status).toBe('running')
    expect(job?.startedAt).toBe(zacatek)
    expect(job?.wanted).toBe(8)
    // Název tématu i to, kam v knihovně patří — bez toho je výpis jen řada id.
    expect(job?.topicName).toBeTruthy()
    expect(job?.place).toContain('ročník')
  })

  it('u nedokončeného tématu nese výpis českou hlášku i to, co stihlo vzniknout', async () => {
    await seedJob('error', { error: 'Dnešní limit modelu je vyčerpaný. Zkus to zítra.', producedCount: 3 })

    const { jobs, error } = await prehled()
    expect(error).toBe(1)
    expect(jobs[0]?.error).toContain('limit')
    expect(jobs[0]?.createdCount).toBe(3)
  })

  it('řadí se tak, jak se to čte: co běží, co čeká, co spadlo, co je hotové', async () => {
    await seedJob('done', { producedCount: 5 })
    await seedJob('error', { error: 'Něco se pokazilo' })
    await seedJob('queued')
    await seedJob('running', { startedAt: new Date().toISOString() })

    const { jobs } = await prehled()
    expect(jobs.map((row) => row.status)).toEqual(['running', 'queued', 'error', 'done'])
  })
})

describe('zkusit znovu', () => {
  it('vrátí nedokončené téma mezi čekající a zapomene na chybu', async () => {
    const { jobId } = await seedJob('error', { error: 'Model neodpověděl', producedCount: 2 })

    const body = (await (await RETRY(jsonReq('/api/jobs/retry', 'POST', {}))).json()) as { requeued: number }
    expect(body.requeued).toBe(1)

    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId))
    expect(job?.status).toBe('queued')
    expect(job?.error).toBeNull()
    expect(job?.finishedAt).toBeNull()
  })

  it('umí zkusit znovu jen jedno vybrané téma', async () => {
    const prvni = await seedJob('error', { error: 'Chyba' })
    const druhe = await seedJob('error', { error: 'Chyba' })

    const response = await RETRY(jsonReq('/api/jobs/retry', 'POST', { ids: [prvni.jobId] }))
    expect(((await response.json()) as { requeued: number }).requeued).toBe(1)

    const rows = await db.select().from(generationJobs)
    expect(rows.find((row) => row.id === prvni.jobId)?.status).toBe('queued')
    expect(rows.find((row) => row.id === druhe.jobId)?.status).toBe('error')
  })

  it('téma, které mezitím zase běží, se podruhé nezařadí — vyrobilo by tytéž otázky', async () => {
    const { topicId, jobId } = await seedJob('error', { error: 'Chyba' })
    await seedJob('running', { topicId, startedAt: new Date().toISOString() })

    const body = (await (await RETRY(jsonReq('/api/jobs/retry', 'POST', {}))).json()) as { requeued: number }
    expect(body.requeued).toBe(0)
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId))
    expect(job?.status).toBe('error')
  })

  it('hotová úloha se znovu nespouští', async () => {
    await seedJob('done', { producedCount: 4 })
    const body = (await (await RETRY(jsonReq('/api/jobs/retry', 'POST', {}))).json()) as { requeued: number }
    expect(body.requeued).toBe(0)
  })
})

describe('úklid přehledu', () => {
  it('vyprázdnění fronty nechá výpis hotových na pokoji', async () => {
    await seedJob('queued')
    await seedJob('done', { producedCount: 5 })

    await DELETE(req('/api/jobs'))
    const rows = await db.select().from(generationJobs)
    expect(rows.map((row) => row.status)).toEqual(['done'])
  })

  it('celý přehled jde smazat i s hotovými', async () => {
    await seedJob('done', { producedCount: 5 })
    await seedJob('error', { error: 'Chyba' })

    const body = (await (await DELETE(req('/api/jobs?rozsah=vse'))).json()) as { removed: number }
    expect(body.removed).toBe(2)
    expect(await db.select().from(generationJobs)).toHaveLength(0)
  })
})
