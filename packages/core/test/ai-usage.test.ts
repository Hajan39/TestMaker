import { NoObjectGeneratedError } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { generateQuestions } from '../src/ai/generate'
import { objectCall, startLadder, type AiCallEvent } from '../src/ai/ladder'
import { listAiModels } from '../src/ai/provider'
import { generatePuzzleWords } from '../src/ai/puzzleWords'

vi.mock('ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('ai')>()
  return {
    ...original,
    generateObject: vi.fn(async () => ({ object: { ok: true }, usage: { inputTokens: 3, outputTokens: 4 } })),
  }
})

const A = { provider: 'google', model: 'a' } as const
const B = { provider: 'google', model: 'b' } as const
const LIMIT = 'You exceeded your current quota, please check your plan and billing details.'

function entry() {
  const events: AiCallEvent[] = []
  return { events, onCall: (e: AiCallEvent) => void events.push(e) }
}
const badShape = () =>
  new NoObjectGeneratedError({ message: 'x', text: '{}', response: {} as never, usage: {} as never, finishReason: 'stop' })

describe('measuring calls in the ladder', () => {
  it('success reports ok with tokens and duration', async () => {
    const { events, onCall } = entry()
    await startLadder([A], undefined, onCall).call(async (_c, meter) => { meter.usage(10, 20); return 1 })
    expect(events).toEqual([{ model: 'google:a', outcome: 'ok', inputTokens: 10, outputTokens: 20, durationMs: expect.any(Number) }])
  })
  it('a provider without usage records null', async () => {
    const { events, onCall } = entry()
    await startLadder([A], undefined, onCall).call(async (_c, meter) => { meter.usage(undefined, undefined); return 1 })
    expect(events[0]).toMatchObject({ inputTokens: null, outputTokens: null })
  })
  it('a quota limit is recorded and the ladder moves on', async () => {
    const { events, onCall } = entry()
    await startLadder([A, B], undefined, onCall).call(async (c) => { if (c.model === 'a') throw new Error(LIMIT); return 1 })
    expect(events.map((e) => [e.model, e.outcome])).toEqual([['google:a', 'limit'], ['google:b', 'ok']])
  })
  it('an answer in the wrong shape is bad_shape', async () => {
    const { events, onCall } = entry()
    await expect(startLadder([A], undefined, onCall).call(async () => { throw badShape() })).rejects.toThrow()
    expect(events.map((e) => e.outcome)).toEqual(['bad_shape'])
  })
  it('a wrong key is error', async () => {
    const { events, onCall } = entry()
    await expect(startLadder([A], undefined, onCall).call(async () => { throw new Error('Anthropic API key is missing.') })).rejects.toThrow()
    expect(events.map((e) => e.outcome)).toEqual(['error'])
  })
  it('an abort is not measured', async () => {
    const { events, onCall } = entry()
    const controller = new AbortController()
    controller.abort()
    await expect(startLadder([A], controller.signal, onCall).call(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })).rejects.toThrow()
    expect(events).toEqual([])
  })
  it('an exception from the listener does not break generation', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await startLadder([A], undefined, () => { throw new Error('rozbitý posluchač') }).call(async () => 7)
    expect(result.value).toBe(7)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
  it('without a listener it works as before', async () => {
    expect((await startLadder([A]).call(async () => 5)).value).toBe(5)
  })
})

describe('tokens from generateObject', () => {
  it('objectCall passes usage to the meter', async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test')
    const { events, onCall } = entry()
    const call = objectCall(z.object({ ok: z.boolean() }))
    await startLadder([A], undefined, onCall).call((config, meter) => call({ config, system: 's', prompt: 'p', meter }))
    expect(events[0]).toMatchObject({ outcome: 'ok', inputTokens: 3, outputTokens: 4 })
    vi.unstubAllEnvs()
  })
})

describe('generators pass the listener on', () => {
  it('generateQuestions', async () => {
    const { events, onCall } = entry()
    await generateQuestions(
      { text: 'Koloběh vody v přírodě zahrnuje výpar, srážky a odtok. '.repeat(20), topicName: 'Voda', subjectName: 'Přírodopis', gradeName: null, types: ['short_answer'], difficulty: 2, count: 1 },
      {
        models: [A],
        onCall,
        callModel: async ({ meter }) => {
          meter?.usage(5, 6)
          return { questions: [{ type: 'short_answer', payload: { prompt: 'Co je výpar?', answer: 'odpařování', acceptedAnswers: [] }, blocks: [], points: 1, difficulty: 2 }] }
        },
      },
    )
    expect(events).toMatchObject([{ model: 'google:a', outcome: 'ok', inputTokens: 5, outputTokens: 6 }])
  })
  it('generatePuzzleWords', async () => {
    const { events, onCall } = entry()
    await generatePuzzleWords(
      { text: 'Houba roste v lese.', topicName: 'Houby', subjectName: 'Přírodopis', gradeName: null, count: 1, kind: 'wordsearch' },
      { models: [A], onCall, callModel: async () => ({ words: [{ word: 'houba', clue: 'Roste v lese a má klobouk.' }] }) },
    )
    expect(events.map((e) => e.outcome)).toEqual(['ok'])
  })
})

describe('ladder for the overview', () => {
  it('shows models without a key as well', () => {
    expect(listAiModels({ AI_MODELS: 'google:a, openrouter:b:free, nesmysl', GOOGLE_GENERATIVE_AI_API_KEY: 'k' })).toEqual([
      { model: 'google:a', hasKey: true },
      { model: 'openrouter:b:free', hasKey: false },
    ])
  })
})
