import { describe, expect, it } from 'vitest'
import { generateQuestions, type ModelCall } from '../src/ai/generate'
import { describeAiConfig, isAiConfigured, readAiLadder, readOllamaWorkers } from '../src/ai/provider'
import type { QuestionContent } from '../src/schema/question'

/**
 * Žebříček modelů. Žádný test tady nesmí volat skutečný model — volání se
 * podstrkuje přes `callModel`, takže se nespotřebuje ani kousek limitu.
 */

const ZADANI = {
  text: 'Koloběh vody v přírodě zahrnuje výpar, srážky a odtok. '.repeat(20),
  topicName: 'Koloběh vody',
  subjectName: 'Přírodopis',
  gradeName: '6. ročník',
  types: ['short_answer'] as const,
  difficulty: 2 as const,
}

/** Použitelná otázka, ať se dávka neodmítne na validaci. */
function otazka(poradi: number): QuestionContent {
  return {
    type: 'short_answer',
    payload: { prompt: `Otázka číslo ${poradi}?`, answer: 'odpověď', acceptedAnswers: [] },
    blocks: [],
    points: 1,
    difficulty: 2,
  }
}

const VYCERPANY_LIMIT = 'You exceeded your current quota, please check your plan and billing details.'
const CHYBNY_KLIC = 'Anthropic API key is missing.'

/**
 * Podvržené volání modelu: pro každý model říká, co se má stát. Zaznamenává,
 * kolikrát se na který model sáhlo.
 */
function podvrzenyModel(chovani: Record<string, 'odpovi' | string>): {
  call: ModelCall
  volani: string[]
} {
  const volani: string[] = []
  let poradi = 0
  const call: ModelCall = async ({ config }) => {
    const key = describeAiConfig(config)
    volani.push(key)
    const reakce = chovani[key]
    if (reakce !== 'odpovi') throw new Error(reakce ?? 'neznámý model')
    // Dávka po pěti otázkách jako ve skutečném generování.
    return { questions: Array.from({ length: 5 }, () => otazka(++poradi)) }
  }
  return { call, volani }
}

const PRVNI = { provider: 'google', model: 'a' } as const
const DRUHY = { provider: 'google', model: 'b' } as const

describe('žebříček modelů z prostředí', () => {
  it('bez AI_MODELS se chová jako dřív — jediný model podle AI_PROVIDER a AI_MODEL', () => {
    expect(readAiLadder({ GOOGLE_GENERATIVE_AI_API_KEY: 'gk' })).toEqual([
      { provider: 'google', model: 'gemini-flash-latest' },
    ])
    expect(readAiLadder({ AI_PROVIDER: 'ollama', AI_MODEL: 'qwen3:14b' })).toEqual([
      { provider: 'ollama', model: 'qwen3:14b' },
    ])
  })

  it('položka smí určit poskytovatele, takže jde míchat Gemini a Claude', () => {
    const env = {
      AI_MODELS: 'google:gemini-flash-latest, anthropic:claude-opus-5',
      GOOGLE_GENERATIVE_AI_API_KEY: 'gk',
      ANTHROPIC_API_KEY: 'sk',
    }
    expect(readAiLadder(env)).toEqual([
      { provider: 'google', model: 'gemini-flash-latest' },
      { provider: 'anthropic', model: 'claude-opus-5' },
    ])
  })

  it('položka bez poskytovatele patří tomu, který by se použil i bez žebříčku', () => {
    const env = { AI_MODELS: 'gemini-flash-latest,gemini-flash-lite-latest', GOOGLE_GENERATIVE_AI_API_KEY: 'gk' }
    expect(readAiLadder(env).map((c) => c.provider)).toEqual(['google', 'google'])
    expect(readAiLadder(env).map((c) => c.model)).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest'])
  })

  it('u Ollamy se AI_MODELS nepoužívá jako fallback seznam', () => {
    const env = { AI_PROVIDER: 'ollama', AI_MODELS: 'qwen3:14b,ollama:llama3.1' }
    expect(readAiLadder(env)).toEqual([{ provider: 'ollama', model: 'qwen3:14b' }])
  })

  it('načte Ollama workery s vlastním endpointem a modelem', () => {
    const env = {
      AI_PROVIDER: 'ollama',
      OLLAMA_WORKERS:
        'http://192.168.20.101:11434/api|qwen3:14b,http://192.168.20.109:11434/api|qwen3:8b',
    }
    expect(readOllamaWorkers(env)).toEqual([
      { provider: 'ollama', baseURL: 'http://192.168.20.101:11434/api', model: 'qwen3:14b' },
      { provider: 'ollama', baseURL: 'http://192.168.20.109:11434/api', model: 'qwen3:8b' },
    ])
  })

  it('neplatné nebo duplicitní worker položky přeskočí', () => {
    const env = {
      AI_PROVIDER: 'ollama',
      OLLAMA_WORKERS: 'bad,http://server/api|qwen3:8b,http://server/api|qwen3:8b',
    }
    expect(readOllamaWorkers(env)).toEqual([{ provider: 'ollama', baseURL: 'http://server/api', model: 'qwen3:8b' }])
  })

  it('placený poskytovatel se sám nepřidá — v žebříčku je jen to, co majitel napsal', () => {
    const env = { AI_MODELS: 'google:gemini-flash-latest', GOOGLE_GENERATIVE_AI_API_KEY: 'gk', ANTHROPIC_API_KEY: 'sk' }
    expect(readAiLadder(env)).toEqual([{ provider: 'google', model: 'gemini-flash-latest' }])
  })

  it('model poskytovatele bez klíče se přeskočí, ať na něm žebříček nezhasne', () => {
    const env = { AI_MODELS: 'anthropic:claude-opus-5,google:gemini-flash-latest', GOOGLE_GENERATIVE_AI_API_KEY: 'gk' }
    expect(readAiLadder(env)).toEqual([{ provider: 'google', model: 'gemini-flash-latest' }])
    expect(isAiConfigured(env)).toBe(true)
  })

  it('žebříček bez jediného klíče generování nezapíná', () => {
    expect(isAiConfigured({ AI_MODELS: 'google:gemini-flash-latest,anthropic:claude-opus-5' })).toBe(false)
  })

  it('opakovanou položku bere jen jednou', () => {
    const env = { AI_MODELS: 'google:a,google:a,google:b', GOOGLE_GENERATIVE_AI_API_KEY: 'gk' }
    expect(readAiLadder(env).map(describeAiConfig)).toEqual(['google:a', 'google:b'])
  })
})

describe('přepnutí na další model při vyčerpaném limitu', () => {
  it('hotové dávky zůstanou a zbytek dogeneruje další model', async () => {
    let volanoPoprve = true
    const ulozeno: { pocet: number; model: string }[] = []
    let poradi = 0

    const call: ModelCall = async ({ config }) => {
      const key = describeAiConfig(config)
      // Prvnímu modelu dojde limit až po první dávce — jako u ostrého běhu,
      // kde se denní kvóta vyčerpá uprostřed tématu.
      if (key === 'google:a') {
        if (volanoPoprve) {
          volanoPoprve = false
          return { questions: Array.from({ length: 5 }, () => otazka(++poradi)) }
        }
        throw new Error(VYCERPANY_LIMIT)
      }
      return { questions: Array.from({ length: 5 }, () => otazka(++poradi)) }
    }

    const result = await generateQuestions(
      { ...ZADANI, count: 10, types: [...ZADANI.types] },
      {
        configs: [PRVNI, DRUHY],
        callModel: call,
        onBatch: (batch, info) => {
          ulozeno.push({ pocet: batch.length, model: info.model })
        },
      },
    )

    expect(result.questions).toHaveLength(10)
    // Práce prvního modelu se nezahodila.
    expect(ulozeno).toEqual([
      { pocet: 5, model: 'google:a' },
      { pocet: 5, model: 'google:b' },
    ])
    // V jednom tématu se míchaly modely a je to vidět ve výsledku.
    expect(result.models).toEqual(['google:a', 'google:b'])
  })

  it('vyčerpaný model se do konce běhu už nezkouší', async () => {
    const { call, volani } = podvrzenyModel({ 'google:a': VYCERPANY_LIMIT, 'google:b': 'odpovi' })

    const result = await generateQuestions(
      { ...ZADANI, count: 15, types: [...ZADANI.types] },
      { configs: [PRVNI, DRUHY], callModel: call },
    )

    expect(result.questions).toHaveLength(15)
    // Tři dávky, ale na vyčerpaný model se sáhlo jen jednou.
    expect(volani.filter((m) => m === 'google:a')).toHaveLength(1)
    expect(volani.filter((m) => m === 'google:b')).toHaveLength(3)
    expect(result.models).toEqual(['google:b'])
  })

  it('u chyby, která není na opakování, se další model nezkouší', async () => {
    const { call, volani } = podvrzenyModel({ 'google:a': CHYBNY_KLIC, 'google:b': 'odpovi' })

    await expect(
      generateQuestions({ ...ZADANI, count: 10, types: [...ZADANI.types] }, { configs: [PRVNI, DRUHY], callModel: call }),
    ).rejects.toThrow(/API key/)

    expect(volani).toEqual(['google:a'])
  })

  it('když dojde celý žebříček, propadne chyba posledního modelu nahoru', async () => {
    const { call, volani } = podvrzenyModel({ 'google:a': VYCERPANY_LIMIT, 'google:b': VYCERPANY_LIMIT })

    await expect(
      generateQuestions({ ...ZADANI, count: 10, types: [...ZADANI.types] }, { configs: [PRVNI, DRUHY], callModel: call }),
    ).rejects.toThrow(/quota/)

    expect(volani).toEqual(['google:a', 'google:b'])
  })

  it('jediný model bez žebříčku se chová jako dřív: chyba rovnou padá', async () => {
    const { call, volani } = podvrzenyModel({ 'google:a': VYCERPANY_LIMIT })

    await expect(
      generateQuestions({ ...ZADANI, count: 5, types: [...ZADANI.types] }, { config: PRVNI, callModel: call }),
    ).rejects.toThrow(/quota/)

    expect(volani).toEqual(['google:a'])
  })
})
