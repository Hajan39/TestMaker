import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'
import { ACCOUNT } from './helpers'

/**
 * Running one job from the queue. The model must never really be called here —
 * `@testmaker/core/ai` is mocked and `generateQuestions` returns a ready question.
 * If anyone bypassed the module, the test fails because the fake wasn't called.
 */

const QUESTION: QuestionContent = {
  type: 'single_choice',
  payload: { prompt: 'Kde probíhá fotosyntéza?', options: ['V kořenech', 'V listech'], correctIndex: 1 },
  blocks: [],
  points: 1,
  difficulty: 2,
}

const model = vi.hoisted(() => ({
  /** What the fake generation should do; individual tests override it. */
  impl: null as null | typeof generateQuestions,
  calls: 0,
}))

vi.mock('@testmaker/core/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@testmaker/core/ai')>()
  return {
    ...original,
    isAiConfigured: () => aiConfigured,
    generateQuestions: (async (request, options) => {
      model.calls += 1
      if (!model.impl) throw new Error('Test nenastavil podvržené generování')
      return model.impl(request, options)
    }) satisfies typeof generateQuestions,
  }
})

let aiConfigured = true

const { GET, POST } = await import('@/app/api/jobs/run/route')
const { db, generationJobs } = await import('@/db')
const { newId } = await import('@/lib/ids')
const { seedMaterial, seedTopic } = await import('./helpers')
type GenerationJobParams = import('@/db').GenerationJobParams

const TEXT = 'Fotosyntéza probíhá v chloroplastech zelených rostlin a vzniká při ní kyslík. '.repeat(6)

const PARAMS: GenerationJobParams = { count: 1, types: ['single_choice'], difficulty: 2, mode: 'add' }

/** A queued job over a topic with a long enough material. */
async function queueJob(
  options: { status?: 'queued' | 'running'; startedAt?: string | null; text?: string } = {},
): Promise<{ jobId: string; topicId: string }> {
  const { topicId } = await seedTopic()
  await seedMaterial(topicId, { text: options.text ?? TEXT })
  const jobId = newId()
  await db.insert(generationJobs).values({
    id: jobId,
    schoolId: ACCOUNT.schoolId,
    requestedBy: ACCOUNT.userId,
    topicId,
    params: PARAMS,
    status: options.status ?? 'queued',
    startedAt: options.startedAt ?? null,
  })
  return { jobId, topicId }
}

async function jobRow(id: string) {
  const [row] = await db.select().from(generationJobs).where(eq(generationJobs.id, id)).limit(1)
  return row
}

beforeEach(async () => {
  aiConfigured = true
  model.calls = 0
  model.impl = async (_request, options) => {
    // Real generation saves questions as it goes via `onBatch`; the fake must
    // behave the same, otherwise the job would end with zero questions created.
    await options?.onBatch?.([QUESTION], { model: 'google:gemini-flash-latest' })
    return {
      questions: [QUESTION],
      rejected: [],
      chunks: 1,
      failedCalls: [],
      models: ['google:gemini-flash-latest'],
    }
  }
  await db.delete(generationJobs)
})

describe('processing a queued job', () => {
  it('without a configured model responds 503 and processes nothing', async () => {
    aiConfigured = false
    await queueJob()

    const response = await POST()
    expect(response.status).toBe(503)
    expect(model.calls).toBe(0)
  })

  it('an empty queue is not an error', async () => {
    const body = (await (await POST()).json()) as { processed: boolean; remaining: number }
    expect(body).toMatchObject({ processed: false, remaining: 0 })
  })

  it('takes the oldest queued job, finishes it and records the question count', async () => {
    const { jobId } = await queueJob()

    const body = (await (await POST()).json()) as { processed: boolean; created: number; remaining: number }
    expect(body).toMatchObject({ processed: true, created: 1, remaining: 0 })
    expect(model.calls).toBe(1)

    const job = await jobRow(jobId)
    expect(job?.status).toBe('done')
    expect(job?.producedCount).toBe(1)
    expect(job?.finishedAt).toBeTruthy()
  })

  it('a model call from the queue is recorded without a user', async () => {
    const { aiCalls } = await import('@/db')
    await db.delete(aiCalls)
    const original = model.impl!
    model.impl = async (request, options) => {
      options?.onCall?.({ model: 'google:a', outcome: 'ok', inputTokens: 1, outputTokens: 2, durationMs: 3 })
      return original(request, options)
    }
    await queueJob()
    await POST()

    await vi.waitFor(async () => {
      expect(await db.select().from(aiCalls)).toMatchObject([
        { schoolId: ACCOUNT.schoolId, userId: null, task: 'otazky', model: 'google:a' },
      ])
    })
  })

  it('remaining jobs are counted so the UI knows to call again', async () => {
    await queueJob()
    await queueJob()

    const body = (await (await POST()).json()) as { remaining: number }
    expect(body.remaining).toBe(1)
  })

  it('a model failure ends the job with a user-facing message, not a crash', async () => {
    const { jobId } = await queueJob()
    model.impl = async () => {
      throw new Error('You exceeded your current quota, please check your plan')
    }

    const body = (await (await POST()).json()) as { processed: boolean; error: string }
    expect(body.processed).toBe(true)
    expect(body.error).toMatch(/limit|kvót|Zkus/i)

    const job = await jobRow(jobId)
    expect(job?.status).toBe('error')
    expect(job?.error).toBeTruthy()
  })

  it('a topic without enough text ends the job with an error, the model is not called', async () => {
    const { jobId } = await queueJob({ text: 'Krátký text.' })

    const body = (await (await POST()).json()) as { error: string }
    expect(model.calls).toBe(0)
    expect(body.error).toContain('málo textu')
    expect((await jobRow(jobId))?.status).toBe('error')
  })

  it('the scheduler (GET) processes a job just like the UI (POST)', async () => {
    const { jobId } = await queueJob()

    const body = (await (await GET()).json()) as { processed: boolean }
    expect(body.processed).toBe(true)
    expect((await jobRow(jobId))?.status).toBe('done')
  })
})

describe('stuck jobs', () => {
  it('a job running longer than the limit is requeued and processed right away', async () => {
    const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { jobId } = await queueJob({ status: 'running', startedAt: longAgo })

    const body = (await (await POST()).json()) as { revived?: number; processed: boolean }
    expect(body.processed).toBe(true)
    expect((await jobRow(jobId))?.status).toBe('done')
  })

  it('a running job without a start time is requeued too — a crash must not block the topic forever', async () => {
    const { jobId } = await queueJob({ status: 'running', startedAt: null })

    await POST()
    expect((await jobRow(jobId))?.status).toBe('done')
  })

  it('a freshly running job is left alone — it is being worked on', async () => {
    const { jobId } = await queueJob({ status: 'running', startedAt: new Date().toISOString() })

    const body = (await (await POST()).json()) as { processed: boolean; revived: number }
    expect(body).toMatchObject({ processed: false, revived: 0 })
    expect((await jobRow(jobId))?.status).toBe('running')
    expect(model.calls).toBe(0)
  })
})
