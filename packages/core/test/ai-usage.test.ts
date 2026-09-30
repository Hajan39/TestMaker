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

function zaznam() {
  const udalosti: AiCallEvent[] = []
  return { udalosti, onCall: (e: AiCallEvent) => void udalosti.push(e) }
}
const spatnyTvar = () =>
  new NoObjectGeneratedError({ message: 'x', text: '{}', response: {} as never, usage: {} as never, finishReason: 'stop' })

describe('měření volání v žebříčku', () => {
  it('úspěch hlásí ok s tokeny a dobou', async () => {
    const { udalosti, onCall } = zaznam()
    await startLadder([A], undefined, onCall).call(async (_c, meter) => { meter.usage(10, 20); return 1 })
    expect(udalosti).toEqual([{ model: 'google:a', outcome: 'ok', inputTokens: 10, outputTokens: 20, durationMs: expect.any(Number) }])
  })
  it('poskytovatel bez usage zapíše null', async () => {
    const { udalosti, onCall } = zaznam()
    await startLadder([A], undefined, onCall).call(async (_c, meter) => { meter.usage(undefined, undefined); return 1 })
    expect(udalosti[0]).toMatchObject({ inputTokens: null, outputTokens: null })
  })
  it('limit se zapíše a žebříček jde dál', async () => {
    const { udalosti, onCall } = zaznam()
    await startLadder([A, B], undefined, onCall).call(async (c) => { if (c.model === 'a') throw new Error(LIMIT); return 1 })
    expect(udalosti.map((e) => [e.model, e.outcome])).toEqual([['google:a', 'limit'], ['google:b', 'ok']])
  })
  it('odpověď ve špatném tvaru je bad_shape', async () => {
    const { udalosti, onCall } = zaznam()
    await expect(startLadder([A], undefined, onCall).call(async () => { throw spatnyTvar() })).rejects.toThrow()
    expect(udalosti.map((e) => e.outcome)).toEqual(['bad_shape'])
  })
  it('chybný klíč je error', async () => {
    const { udalosti, onCall } = zaznam()
    await expect(startLadder([A], undefined, onCall).call(async () => { throw new Error('Anthropic API key is missing.') })).rejects.toThrow()
    expect(udalosti.map((e) => e.outcome)).toEqual(['error'])
  })
  it('přerušení se neměří', async () => {
    const { udalosti, onCall } = zaznam()
    const controller = new AbortController()
    controller.abort()
    await expect(startLadder([A], controller.signal, onCall).call(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })).rejects.toThrow()
    expect(udalosti).toEqual([])
  })
  it('výjimka z posluchače generování neshodí', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const vysledek = await startLadder([A], undefined, () => { throw new Error('rozbitý posluchač') }).call(async () => 7)
    expect(vysledek.value).toBe(7)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
  it('bez posluchače funguje jako dřív', async () => {
    expect((await startLadder([A]).call(async () => 5)).value).toBe(5)
  })
})

describe('tokeny z generateObject', () => {
  it('objectCall předá usage do měřiče', async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test')
    const { udalosti, onCall } = zaznam()
    const call = objectCall(z.object({ ok: z.boolean() }))
    await startLadder([A], undefined, onCall).call((config, meter) => call({ config, system: 's', prompt: 'p', meter }))
    expect(udalosti[0]).toMatchObject({ outcome: 'ok', inputTokens: 3, outputTokens: 4 })
    vi.unstubAllEnvs()
  })
})

describe('generátory předávají posluchače', () => {
  it('generateQuestions', async () => {
    const { udalosti, onCall } = zaznam()
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
    expect(udalosti).toMatchObject([{ model: 'google:a', outcome: 'ok', inputTokens: 5, outputTokens: 6 }])
  })
  it('generatePuzzleWords', async () => {
    const { udalosti, onCall } = zaznam()
    await generatePuzzleWords(
      { text: 'Houba roste v lese.', topicName: 'Houby', subjectName: 'Přírodopis', gradeName: null, count: 1, kind: 'wordsearch' },
      { models: [A], onCall, callModel: async () => ({ words: [{ word: 'houba', clue: 'Roste v lese a má klobouk.' }] }) },
    )
    expect(udalosti.map((e) => e.outcome)).toEqual(['ok'])
  })
})

describe('žebříček pro přehled', () => {
  it('ukáže i modely bez klíče', () => {
    expect(listAiModels({ AI_MODELS: 'google:a, openrouter:b:free, nesmysl', GOOGLE_GENERATIVE_AI_API_KEY: 'k' })).toEqual([
      { model: 'google:a', hasKey: true },
      { model: 'openrouter:b:free', hasKey: false },
    ])
  })
})
