import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { DELETE, GET } from '@/app/api/jobs/route'
import { POST as RETRY } from '@/app/api/jobs/retry/route'
import { db, generationJobs, type GenerationJobParams } from '@/db'
import { newId } from '@/lib/ids'
import { jsonReq, req, seedTopic, ACCOUNT } from './helpers'

/**
 * The generation overview. The teacher must see what runs, what waits and what
 * failed — and an unfinished topic must be retryable without regenerating the
 * whole grade.
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

/** A job over a new topic in the given state. */
async function seedJob(
  status: 'queued' | 'running' | 'done' | 'error',
  extra: { error?: string; producedCount?: number; startedAt?: string; topicId?: string } = {},
): Promise<{ jobId: string; topicId: string }> {
  const topicId = extra.topicId ?? (await seedTopic()).topicId
  const jobId = newId()
  await db.insert(generationJobs).values({
    id: jobId,
    schoolId: ACCOUNT.schoolId,
    requestedBy: ACCOUNT.userId,
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

async function overview(): Promise<{ jobs: JobRow[]; running: number; queued: number; error: number }> {
  const response = await GET(req('/api/jobs?vypis=1'))
  expect(response.status).toBe(200)
  return (await response.json()) as { jobs: JobRow[]; running: number; queued: number; error: number }
}

beforeEach(async () => {
  await db.delete(generationJobs)
})

describe('queue listing', () => {
  it('without a parameter returns only counts — the toolbar indicator asks often', async () => {
    await seedJob('queued')
    const body = (await (await GET(req('/api/jobs'))).json()) as Record<string, unknown>
    expect(body).toMatchObject({ queued: 1 })
    expect(body.jobs).toBeUndefined()
  })

  it('lists the topic being generated, since when it runs and how many questions were wanted', async () => {
    const start = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { topicId } = await seedJob('running', { startedAt: start })

    const { jobs, running } = await overview()
    expect(running).toBe(1)
    const job = jobs.find((row) => row.topicId === topicId)
    expect(job?.status).toBe('running')
    expect(job?.startedAt).toBe(start)
    expect(job?.wanted).toBe(8)
    // The topic name and where it belongs in the library — otherwise the list is just ids.
    expect(job?.topicName).toBeTruthy()
    expect(job?.place).toContain('ročník')
  })

  it('for an unfinished topic the listing carries the message and what got created', async () => {
    await seedJob('error', { error: 'Dnešní limit modelu je vyčerpaný. Zkus to zítra.', producedCount: 3 })

    const { jobs, error } = await overview()
    expect(error).toBe(1)
    expect(jobs[0]?.error).toContain('limit')
    expect(jobs[0]?.createdCount).toBe(3)
  })

  it('is ordered the way it is read: running, queued, failed, done', async () => {
    await seedJob('done', { producedCount: 5 })
    await seedJob('error', { error: 'Něco se pokazilo' })
    await seedJob('queued')
    await seedJob('running', { startedAt: new Date().toISOString() })

    const { jobs } = await overview()
    expect(jobs.map((row) => row.status)).toEqual(['running', 'queued', 'error', 'done'])
  })
})

describe('retry', () => {
  it('puts an unfinished topic back into the queue and forgets the error', async () => {
    const { jobId } = await seedJob('error', { error: 'Model neodpověděl', producedCount: 2 })

    const body = (await (await RETRY(jsonReq('/api/jobs/retry', 'POST', {}))).json()) as { requeued: number }
    expect(body.requeued).toBe(1)

    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId))
    expect(job?.status).toBe('queued')
    expect(job?.error).toBeNull()
    expect(job?.finishedAt).toBeNull()
  })

  it('can retry just one chosen topic', async () => {
    const first = await seedJob('error', { error: 'Chyba' })
    const second = await seedJob('error', { error: 'Chyba' })

    const response = await RETRY(jsonReq('/api/jobs/retry', 'POST', { ids: [first.jobId] }))
    expect(((await response.json()) as { requeued: number }).requeued).toBe(1)

    const rows = await db.select().from(generationJobs)
    expect(rows.find((row) => row.id === first.jobId)?.status).toBe('queued')
    expect(rows.find((row) => row.id === second.jobId)?.status).toBe('error')
  })

  it('a topic running again meanwhile is not enqueued twice — it would produce the same questions', async () => {
    const { topicId, jobId } = await seedJob('error', { error: 'Chyba' })
    await seedJob('running', { topicId, startedAt: new Date().toISOString() })

    const body = (await (await RETRY(jsonReq('/api/jobs/retry', 'POST', {}))).json()) as { requeued: number }
    expect(body.requeued).toBe(0)
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId))
    expect(job?.status).toBe('error')
  })

  it('a finished job is not restarted', async () => {
    await seedJob('done', { producedCount: 4 })
    const body = (await (await RETRY(jsonReq('/api/jobs/retry', 'POST', {}))).json()) as { requeued: number }
    expect(body.requeued).toBe(0)
  })
})

describe('overview cleanup', () => {
  it('clearing the queue leaves the finished list alone', async () => {
    await seedJob('queued')
    await seedJob('done', { producedCount: 5 })

    await DELETE(req('/api/jobs'))
    const rows = await db.select().from(generationJobs)
    expect(rows.map((row) => row.status)).toEqual(['done'])
  })

  it('the whole overview can be deleted including finished jobs', async () => {
    await seedJob('done', { producedCount: 5 })
    await seedJob('error', { error: 'Chyba' })

    const body = (await (await DELETE(req('/api/jobs?rozsah=vse'))).json()) as { removed: number }
    expect(body.removed).toBe(2)
    expect(await db.select().from(generationJobs)).toHaveLength(0)
  })
})
