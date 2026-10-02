import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DELETE, GET, POST } from '@/app/api/jobs/route'
import { auditLog, db, generationJobs, materials, type GenerationJobParams } from '@/db'
import { technicalDetail } from '@/lib/aiFailure'
import { newId } from '@/lib/ids'
import { jsonReq, req, seedMaterial, seedQuestion, seedTopic, ACCOUNT } from './helpers'

/**
 * The bulk generation queue. Enqueuing happens over the whole library at once,
 * so this is where a topic most easily gets enqueued twice or not at all.
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

/** A topic with a material — without text it isn't enqueued. */
async function topicWithMaterial(): Promise<string> {
  const { topicId } = await seedTopic()
  await seedMaterial(topicId)
  return topicId
}

describe('enqueuing', () => {
  it('enqueues a topic with a material and stores its parameters', async () => {
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

  it('a topic without materials is not enqueued — nothing to generate from', async () => {
    const { topicId } = await seedTopic()
    const result = await enqueue({ topicIds: [topicId] })
    expect(result.enqueued).toBe(0)
    expect(await jobsOf(topicId)).toHaveLength(0)
  })

  it('a topic with only duplicate materials is not enqueued', async () => {
    const { topicId } = await seedTopic()
    const elsewhere = await seedTopic()
    const originalId = await seedMaterial(elsewhere.topicId, { fileName: 'Originál.docx' })
    const copyId = await seedMaterial(topicId, { fileName: 'Kopie.pdf' })
    await db.update(materials).set({ duplicateOfId: originalId }).where(eq(materials.id, copyId))

    const result = await enqueue({ topicIds: [topicId] })
    expect(result.enqueued).toBe(0)
  })

  it('a topic whose only material is manually excluded is not enqueued', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Vyřazený.docx', excluded: true })

    const result = await enqueue({ topicIds: [topicId] })
    expect(result.enqueued).toBe(0)
  })

  it('a topic that already has questions is skipped', async () => {
    const topicId = await topicWithMaterial()
    await seedQuestion(topicId)

    const result = await enqueue({ topicIds: [topicId] })
    expect(result).toMatchObject({ enqueued: 0, skipped: 1 })
  })

  it('when topping up a topic with questions is not skipped — it is the point', async () => {
    const topicId = await topicWithMaterial()
    await seedQuestion(topicId)

    const result = await enqueue({ topicIds: [topicId], mode: 'target', count: 20 })
    expect(result.enqueued).toBe(1)
    expect((await jobsOf(topicId))[0]?.params as GenerationJobParams).toMatchObject({ mode: 'target' })
  })

  it('a topic already waiting in the queue is not enqueued twice', async () => {
    const topicId = await topicWithMaterial()
    await enqueue({ topicIds: [topicId] })

    const result = await enqueue({ topicIds: [topicId] })
    expect(result).toMatchObject({ enqueued: 0, skipped: 1 })
    expect(await jobsOf(topicId)).toHaveLength(1)
  })

  it('the range can be a whole grade or a whole subject', async () => {
    const { subjectId, gradeId, topicId } = await seedTopic()
    await seedMaterial(topicId)

    expect(await enqueue({ gradeId })).toMatchObject({ enqueued: 1 })
    await db.delete(generationJobs).where(eq(generationJobs.topicId, topicId))
    expect(await enqueue({ subjectId })).toMatchObject({ enqueued: 1 })
  })

  it('without a range nothing is enqueued', async () => {
    expect(await enqueue({})).toMatchObject({ enqueued: 0, skipped: 0 })
  })

  it('nonsensical parameters return 400', async () => {
    const response = await POST(jsonReq('/api/jobs', 'POST', { count: 999 }))
    expect(response.status).toBe(400)
  })
})

describe('queue status and clearing', () => {
  it('counts jobs per state', async () => {
    const { topicId } = await seedTopic()
    // The test file shares one database — count what is in the queue now.
    await db.delete(generationJobs)
    await db.insert(generationJobs).values([
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'queued' },
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'running', startedAt: new Date().toISOString() },
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'done' },
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'error' },
    ])

    const body = (await (await GET(req('/api/jobs'))).json()) as Record<string, number>
    expect(body).toMatchObject({ queued: 1, running: 1, done: 1, error: 1 })
  })

  it('clearing also deletes stuck running jobs, keeps finished ones', async () => {
    const { topicId } = await seedTopic()
    await db.delete(generationJobs)
    await db.insert(generationJobs).values([
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'queued' },
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'running' },
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'error' },
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'done' },
    ])

    const body = (await (await DELETE(req('/api/jobs'))).json()) as { removed: number }
    expect(body.removed).toBe(3)
    const rest = await db.select().from(generationJobs)
    expect(rest.map((row) => row.status)).toEqual(['done'])
  })
})

describe('generation cut off by the server', () => {
  const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  it('a direct generation still "running" an hour later is failed and logged, so nothing spins forever', async () => {
    const { topicId } = await seedTopic()
    await db.delete(generationJobs)
    const id = newId()
    await db.insert(generationJobs).values({
      id,
      schoolId: ACCOUNT.schoolId,
      requestedBy: ACCOUNT.userId,
      topicId,
      params: { count: 10, types: [], difficulty: 'mix', direct: true },
      status: 'running',
      createdAt: longAgo,
      startedAt: longAgo,
    })

    const body = (await (await GET(req('/api/jobs'))).json()) as Record<string, number>
    expect(body).toMatchObject({ running: 0, error: 1 })
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, id))
    expect(job?.error).toMatch(/přerušilo/)
    const events = await db.select().from(auditLog).where(eq(auditLog.entityId, topicId))
    expect(events.some((event) => event.action === 'fronta-prerusena' && event.severity === 'chyba')).toBe(true)
  })

  it('a stale queue job goes back to the queue instead', async () => {
    const { topicId } = await seedTopic()
    await db.delete(generationJobs)
    const id = newId()
    await db.insert(generationJobs).values({
      id,
      schoolId: ACCOUNT.schoolId,
      requestedBy: ACCOUNT.userId,
      topicId,
      params: { count: 10, types: [], difficulty: 'mix' },
      status: 'running',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      startedAt: longAgo,
    })

    const body = (await (await GET(req('/api/jobs'))).json()) as Record<string, number>
    expect(body).toMatchObject({ running: 0, queued: 1, error: 0 })
  })
})

describe('technical detail of a failure', () => {
  it('follows the cause chain and keeps the HTTP status and provider answer', () => {
    const provider = Object.assign(new Error('Resource exhausted'), {
      name: 'AI_APICallError',
      statusCode: 429,
      responseBody: '{"error":{"message":"Quota exceeded for model"}}',
    })
    const wrapped = new Error('Failed after 3 attempts', { cause: provider })
    const detail = technicalDetail(wrapped)
    expect(detail).toContain('Failed after 3 attempts')
    expect(detail).toContain('[HTTP 429]')
    expect(detail).toContain('Quota exceeded for model')
  })
})
