import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'

/**
 * Běh jedné úlohy z fronty. Model se sem nikdy nesmí zavolat doopravdy —
 * `@testmaker/core/ai` je proto podvržený a `generateQuestions` vrací hotovou
 * otázku. Kdyby modul kdokoli obešel, test spadne na tom, že se nevolala atrapa.
 */

const OTAZKA: QuestionContent = {
  type: 'single_choice',
  payload: { prompt: 'Kde probíhá fotosyntéza?', options: ['V kořenech', 'V listech'], correctIndex: 1 },
  blocks: [],
  points: 1,
  difficulty: 2,
}

const model = vi.hoisted(() => ({
  /** Co má podvržené generování udělat; jednotlivé testy si to přenastaví. */
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

/** Úloha ve frontě nad tématem s dost dlouhým materiálem. */
async function queueJob(
  options: { status?: 'queued' | 'running'; startedAt?: string | null; text?: string } = {},
): Promise<{ jobId: string; topicId: string }> {
  const { topicId } = await seedTopic()
  await seedMaterial(topicId, { text: options.text ?? TEXT })
  const jobId = newId()
  await db.insert(generationJobs).values({
    id: jobId,
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
    // Skutečné generování ukládá otázky průběžně přes `onBatch`; atrapa se
    // musí chovat stejně, jinak by úloha skončila s nulou vytvořených otázek.
    await options?.onBatch?.([OTAZKA], { model: 'google:gemini-flash-latest' })
    return {
      questions: [OTAZKA],
      rejected: [],
      chunks: 1,
      failedCalls: [],
      models: ['google:gemini-flash-latest'],
    }
  }
  await db.delete(generationJobs)
})

describe('zpracování úlohy z fronty', () => {
  it('bez nastaveného modelu odpoví 503 a nic nezpracuje', async () => {
    aiConfigured = false
    await queueJob()

    const response = await POST()
    expect(response.status).toBe(503)
    expect(model.calls).toBe(0)
  })

  it('prázdná fronta není chyba', async () => {
    const body = (await (await POST()).json()) as { processed: boolean; remaining: number }
    expect(body).toMatchObject({ processed: false, remaining: 0 })
  })

  it('vezme nejstarší čekající úlohu, dokončí ji a zapíše počet otázek', async () => {
    const { jobId } = await queueJob()

    const body = (await (await POST()).json()) as { processed: boolean; created: number; remaining: number }
    expect(body).toMatchObject({ processed: true, created: 1, remaining: 0 })
    expect(model.calls).toBe(1)

    const job = await jobRow(jobId)
    expect(job?.status).toBe('done')
    expect(job?.producedCount).toBe(1)
    expect(job?.finishedAt).toBeTruthy()
  })

  it('zbývající úlohy se počítají, ať rozhraní ví, že má volat znovu', async () => {
    await queueJob()
    await queueJob()

    const body = (await (await POST()).json()) as { remaining: number }
    expect(body.remaining).toBe(1)
  })

  it('selhání modelu skončí u úlohy českou hláškou, ne pádem', async () => {
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

  it('téma bez dost textu skončí chybou u úlohy, model se nevolá', async () => {
    const { jobId } = await queueJob({ text: 'Krátký text.' })

    const body = (await (await POST()).json()) as { error: string }
    expect(model.calls).toBe(0)
    expect(body.error).toContain('málo textu')
    expect((await jobRow(jobId))?.status).toBe('error')
  })

  it('plánovač (GET) zpracuje úlohu stejně jako rozhraní (POST)', async () => {
    const { jobId } = await queueJob()

    const body = (await (await GET()).json()) as { processed: boolean }
    expect(body.processed).toBe(true)
    expect((await jobRow(jobId))?.status).toBe('done')
  })
})

describe('zaseknuté úlohy', () => {
  it('úloha běžící déle než limit se vrátí mezi čekající a hned zpracuje', async () => {
    const davno = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { jobId } = await queueJob({ status: 'running', startedAt: davno })

    const body = (await (await POST()).json()) as { revived?: number; processed: boolean }
    expect(body.processed).toBe(true)
    expect((await jobRow(jobId))?.status).toBe('done')
  })

  it('běžící úloha bez času spuštění se taky vrátí — po pádu se téma nesmí zablokovat navždy', async () => {
    const { jobId } = await queueJob({ status: 'running', startedAt: null })

    await POST()
    expect((await jobRow(jobId))?.status).toBe('done')
  })

  it('čerstvě běžící úloha se nesahá — právě se na ní pracuje', async () => {
    const { jobId } = await queueJob({ status: 'running', startedAt: new Date().toISOString() })

    const body = (await (await POST()).json()) as { processed: boolean; revived: number }
    expect(body).toMatchObject({ processed: false, revived: 0 })
    expect((await jobRow(jobId))?.status).toBe('running')
    expect(model.calls).toBe(0)
  })
})
