import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'

/**
 * Generation progress as the topic screen sees it. The model is never really
 * called — `@testmaker/core/ai` is mocked and reports finished batches via
 * `onBatch`, exactly like real generation.
 *
 * What matters is that the UI learns about every saved batch: without it a
 * long material shows only a spinner for ten minutes.
 */

function question(prompt: string): QuestionContent {
  return {
    type: 'single_choice',
    payload: { prompt, options: ['V kořenech', 'V listech'], correctIndex: 1 },
    blocks: [],
    points: 1,
    difficulty: 2,
  }
}

const model = vi.hoisted(() => ({
  impl: null as null | typeof generateQuestions,
}))

vi.mock('@testmaker/core/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@testmaker/core/ai')>()
  return {
    ...original,
    isAiConfigured: () => true,
    generateQuestions: (async (request, options) => {
      if (!model.impl) throw new Error('Test nenastavil podvržené generování')
      return model.impl(request, options)
    }) satisfies typeof generateQuestions,
  }
})

const { POST } = await import('@/app/api/generate/route')
const { db, generationJobs } = await import('@/db')
const { jsonReq, seedMaterial, seedTopic } = await import('./helpers')

const TEXT = 'Fotosyntéza probíhá v chloroplastech zelených rostlin a vzniká při ní kyslík. '.repeat(6)

interface StreamEvent {
  type: string
  [key: string]: unknown
}

/** Runs generation and collects all stream events. */
async function generate(topicId: string): Promise<StreamEvent[]> {
  const response = await POST(jsonReq('/api/generate', 'POST', { topicId, count: 4 }))
  expect(response.status).toBe(200)
  const text = await response.text()
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StreamEvent)
}

beforeEach(async () => {
  await db.delete(generationJobs)
  model.impl = async (_request, options) => {
    await options?.onBatch?.([question('Kde probíhá fotosyntéza?')], { model: 'google:gemini-flash-latest' })
    await options?.onBatch?.([question('Co při fotosyntéze vzniká?')], { model: 'google:gemini-flash-latest' })
    options?.onChunk?.(1, 1)
    return {
      questions: [question('Kde probíhá fotosyntéza?'), question('Co při fotosyntéze vzniká?')],
      rejected: [{ index: 0, errors: ['Správná odpověď chybí mezi možnostmi'] }],
      chunks: 1,
      failedCalls: [],
      models: ['google:gemini-flash-latest'],
    }
  }
})

describe('generation progress', () => {
  it('reports after each saved batch how many questions are done', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const events = await generate(topicId)
    const saved = events.filter((event) => event.type === 'saved')

    expect(saved.map((event) => event.created)).toEqual([1, 2])
  })

  it('also sends the questions themselves so the list grows while running', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const events = await generate(topicId)
    const first = events.find((event) => event.type === 'saved')
    const questions = first?.questions as { id: string; payload: { prompt: string } }[]

    expect(questions).toHaveLength(1)
    // The question is already saved — it has a database id, not just model content.
    expect(questions[0]?.id).toBeTruthy()
    expect(questions[0]?.payload.prompt).toBe('Kde probíhá fotosyntéza?')
  })

  it('at the end says how many questions were created and how many discarded', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const events = await generate(topicId)
    const done = events.at(-1)

    expect(done).toMatchObject({ type: 'done', created: 2, rejected: 1, failedCalls: 0, sources: 1 })
  })

  it('after finishing the topic is free again and the queue keeps a trace of the outcome', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    await generate(topicId)
    const [job] = await db.select().from(generationJobs)
    expect(job?.status).toBe('done')
    expect(job?.producedCount).toBe(2)
  })

  it('a model failure ends with a user-facing message and releases the topic', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    model.impl = async () => {
      throw new Error('You exceeded your current quota, please check your plan')
    }

    const events = await generate(topicId)
    const error = events.at(-1)
    expect(error?.type).toBe('error')
    expect(String(error?.message)).toMatch(/limit|kvót|Zkus/i)

    const [job] = await db.select().from(generationJobs)
    expect(job?.status).toBe('error')
    expect(job?.error).toBeTruthy()
  })

  it('a second generation over the same topic does not start while the first runs', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    // The claim stays after the first call until the stream is read to the end.
    const first = POST(jsonReq('/api/generate', 'POST', { topicId, count: 4 }))
    const second = await POST(jsonReq('/api/generate', 'POST', { topicId, count: 4 }))
    expect(second.status).toBe(409)
    await (await first).text()
  })
})
