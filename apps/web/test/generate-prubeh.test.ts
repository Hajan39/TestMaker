import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'

/**
 * Průběh generování tak, jak ho vidí obrazovka tématu. Model se sem nikdy
 * nevolá doopravdy — `@testmaker/core/ai` je podvržený a hlásí hotové dávky
 * přes `onBatch`, přesně jako to dělá skutečné generování.
 *
 * Podstatné je, že se o každé uložené dávce dozví i rozhraní: bez toho se
 * u dlouhého materiálu deset minut točí jen kolečko.
 */

function otazka(prompt: string): QuestionContent {
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

/** Spustí generování a posbírá všechny události streamu. */
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
    await options?.onBatch?.([otazka('Kde probíhá fotosyntéza?')], { model: 'google:gemini-flash-latest' })
    await options?.onBatch?.([otazka('Co při fotosyntéze vzniká?')], { model: 'google:gemini-flash-latest' })
    options?.onChunk?.(1, 1)
    return {
      questions: [otazka('Kde probíhá fotosyntéza?'), otazka('Co při fotosyntéze vzniká?')],
      rejected: [{ index: 0, errors: ['Správná odpověď chybí mezi možnostmi'] }],
      chunks: 1,
      failedCalls: [],
      models: ['google:gemini-flash-latest'],
    }
  }
})

describe('průběh generování', () => {
  it('po každé uložené dávce hlásí, kolik otázek už je hotových', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const events = await generate(topicId)
    const saved = events.filter((event) => event.type === 'saved')

    expect(saved.map((event) => event.created)).toEqual([1, 2])
  })

  it('posílá i samotné otázky, aby v seznamu přibývaly za běhu', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const events = await generate(topicId)
    const prvni = events.find((event) => event.type === 'saved')
    const questions = prvni?.questions as { id: string; payload: { prompt: string } }[]

    expect(questions).toHaveLength(1)
    // Otázka je už uložená — má id z databáze, ne jen obsah od modelu.
    expect(questions[0]?.id).toBeTruthy()
    expect(questions[0]?.payload.prompt).toBe('Kde probíhá fotosyntéza?')
  })

  it('na konci řekne, kolik otázek vzniklo a kolik se zahodilo', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const events = await generate(topicId)
    const done = events.at(-1)

    expect(done).toMatchObject({ type: 'done', created: 2, rejected: 1, failedCalls: 0, sources: 1 })
  })

  it('po doběhnutí je téma zase volné a ve frontě zůstane stopa, jak to dopadlo', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    await generate(topicId)
    const [job] = await db.select().from(generationJobs)
    expect(job?.status).toBe('done')
    expect(job?.producedCount).toBe(2)
  })

  it('selhání modelu skončí českou hláškou a téma se uvolní', async () => {
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

  it('nad tímtéž tématem druhé generování nezačne, dokud první běží', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    // Rezervace zůstane po prvním volání viset, dokud se stream nedočte.
    const first = POST(jsonReq('/api/generate', 'POST', { topicId, count: 4 }))
    const second = await POST(jsonReq('/api/generate', 'POST', { topicId, count: 4 }))
    expect(second.status).toBe(409)
    await (await first).text()
  })
})
