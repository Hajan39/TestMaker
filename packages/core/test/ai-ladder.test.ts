import { generateText } from 'ai'
import { describe, expect, it } from 'vitest'
import { generateQuestions, type ModelCall } from '../src/ai/generate'
import {
  aiNotConfiguredMessage,
  describeAiConfig,
  describeAiSetup,
  getModel,
  isAiConfigured,
  readAiLadder,
} from '../src/ai/provider'
import type { QuestionContent } from '../src/schema/question'

/**
 * Model ladder. No test here may call a real model — calls are faked via
 * `callModel`, so not a bit of quota is used.
 */

const REQUEST = {
  text: 'Koloběh vody v přírodě zahrnuje výpar, srážky a odtok. '.repeat(20),
  topicName: 'Koloběh vody',
  subjectName: 'Přírodopis',
  gradeName: '6. ročník',
  types: ['short_answer'] as const,
  difficulty: 2 as const,
}

/** A usable question, so the batch is not rejected by validation. */
function question(order: number): QuestionContent {
  return {
    type: 'short_answer',
    payload: { prompt: `Otázka číslo ${order}?`, answer: 'odpověď', acceptedAnswers: [] },
    blocks: [],
    points: 1,
    difficulty: 2,
  }
}

const LIMIT_EXHAUSTED = 'You exceeded your current quota, please check your plan and billing details.'
const WRONG_KEY = 'Anthropic API key is missing.'

/**
 * Fake model call: says for each model what should happen. Records how many
 * times each model was called.
 */
function spoofedModel(behavior: Record<string, 'odpovi' | string>): {
  call: ModelCall
  calls: string[]
} {
  const calls: string[] = []
  let order = 0
  const call: ModelCall = async ({ config }) => {
    const key = describeAiConfig(config)
    calls.push(key)
    const reaction = behavior[key]
    if (reaction !== 'odpovi') throw new Error(reaction ?? 'neznámý model')
    // Batches of five questions, as in real generation.
    return { questions: Array.from({ length: 5 }, () => question(++order)) }
  }
  return { call, calls }
}

const FIRST = { provider: 'google', model: 'a' } as const
const SECOND = { provider: 'google', model: 'b' } as const

describe('switching to the next model when quota runs out', () => {
  it('finished batches stay and the next model generates the rest', async () => {
    let calledFirstTime = true
    const saved: { count: number; model: string }[] = []
    let order = 0

    const call: ModelCall = async ({ config }) => {
      const key = describeAiConfig(config)
      // The first model runs out of quota only after the first batch — as in a
      // real run, where the daily quota runs out in the middle of a topic.
      if (key === 'google:a') {
        if (calledFirstTime) {
          calledFirstTime = false
          return { questions: Array.from({ length: 5 }, () => question(++order)) }
        }
        throw new Error(LIMIT_EXHAUSTED)
      }
      return { questions: Array.from({ length: 5 }, () => question(++order)) }
    }

    const result = await generateQuestions(
      { ...REQUEST, count: 10, types: [...REQUEST.types] },
      {
        models: [FIRST, SECOND],
        callModel: call,
        onBatch: (batch, info) => {
          saved.push({ count: batch.length, model: info.model })
        },
      },
    )

    expect(result.questions).toHaveLength(10)
    // The first model's work was not discarded.
    expect(saved).toEqual([
      { count: 5, model: 'google:a' },
      { count: 5, model: 'google:b' },
    ])
    // Models were mixed within one topic and the result shows it.
    expect(result.models).toEqual(['google:a', 'google:b'])
  })

  it('an exhausted model is not tried again until the end of the run', async () => {
    const { call, calls } = spoofedModel({ 'google:a': LIMIT_EXHAUSTED, 'google:b': 'odpovi' })

    const result = await generateQuestions(
      { ...REQUEST, count: 15, types: [...REQUEST.types] },
      { models: [FIRST, SECOND], callModel: call },
    )

    expect(result.questions).toHaveLength(15)
    // Three batches, but the exhausted model was called only once.
    expect(calls.filter((m) => m === 'google:a')).toHaveLength(1)
    expect(calls.filter((m) => m === 'google:b')).toHaveLength(3)
    expect(result.models).toEqual(['google:b'])
  })

  it('for an error not worth retrying, the next model is not tried', async () => {
    const { call, calls } = spoofedModel({ 'google:a': WRONG_KEY, 'google:b': 'odpovi' })

    await expect(
      generateQuestions({ ...REQUEST, count: 10, types: [...REQUEST.types] }, { models: [FIRST, SECOND], callModel: call }),
    ).rejects.toThrow(/API key/)

    expect(calls).toEqual(['google:a'])
  })

  it('when the whole ladder is exhausted, the last model\'s error propagates up', async () => {
    const { call, calls } = spoofedModel({ 'google:a': LIMIT_EXHAUSTED, 'google:b': LIMIT_EXHAUSTED })

    await expect(
      generateQuestions({ ...REQUEST, count: 10, types: [...REQUEST.types] }, { models: [FIRST, SECOND], callModel: call }),
    ).rejects.toThrow(/quota/)

    expect(calls).toEqual(['google:a', 'google:b'])
  })

  it('a single model without a ladder behaves as before: the error is thrown right away', async () => {
    const { call, calls } = spoofedModel({ 'google:a': LIMIT_EXHAUSTED })

    await expect(
      generateQuestions({ ...REQUEST, count: 5, types: [...REQUEST.types] }, { models: [FIRST], callModel: call }),
    ).rejects.toThrow(/quota/)

    expect(calls).toEqual(['google:a'])
  })
})

describe('ladder without models', () => {
  it('without a single model it ends with an understandable error', async () => {
    await expect(
      generateQuestions({ ...REQUEST, count: 1, types: [...REQUEST.types] }, { models: [] }),
    ).rejects.toThrow(/Žádný model/)
  })
})

describe('model ladder from the environment', () => {
  it('without AI_MODELS it uses the default Gemini when the key is set', () => {
    expect(readAiLadder({ GOOGLE_GENERATIVE_AI_API_KEY: 'g' })).toEqual([
      { provider: 'google', model: 'gemini-flash-latest' },
    ])
  })

  it('without a single key generation is disabled and nothing crashes', () => {
    expect(readAiLadder({})).toEqual([])
    expect(isAiConfigured({})).toBe(false)
  })

  it('keeps the AI_MODELS order and skips providers without a key', () => {
    const env = {
      AI_MODELS: 'anthropic:claude-haiku-4-5, google:gemini-flash-latest, openrouter:deepseek/deepseek-chat',
      GOOGLE_GENERATIVE_AI_API_KEY: 'g',
      OPENROUTER_API_KEY: 'o',
    }
    expect(readAiLadder(env).map(describeAiConfig)).toEqual([
      'google:gemini-flash-latest',
      'openrouter:deepseek/deepseek-chat',
    ])
  })

  it('does not split a colon in the model name', () => {
    expect(readAiLadder({ AI_MODELS: 'openrouter:vendor/model:free', OPENROUTER_API_KEY: 'o' })).toEqual([
      { provider: 'openrouter', model: 'vendor/model:free' },
    ])
  })

  it('skips an unknown provider and an item without a prefix, the rest works', () => {
    const env = {
      AI_MODELS: 'ollama:qwen3:14b, gemini-flash-latest, google:gemini-flash-lite-latest',
      GOOGLE_GENERATIVE_AI_API_KEY: 'g',
    }
    expect(readAiLadder(env)).toEqual([{ provider: 'google', model: 'gemini-flash-lite-latest' }])
  })

  it('adds the same model only once', () => {
    const env = { AI_MODELS: 'google:a, google:a', GOOGLE_GENERATIVE_AI_API_KEY: 'g' }
    expect(readAiLadder(env)).toHaveLength(1)
  })
})

describe('building the model', () => {
  it('OpenRouter targets openrouter.ai with the key from the environment', async () => {
    let url = ''
    let auth = ''
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      auth = new Headers(init?.headers).get('authorization') ?? ''
      return new Response(JSON.stringify({ error: { message: 'x' } }), { status: 400 })
    }) as typeof globalThis.fetch
    const model = await getModel({ provider: 'openrouter', model: 'm' }, { env: { OPENROUTER_API_KEY: 'o' }, fetch })
    await generateText({ model, prompt: 'ahoj', maxRetries: 0 }).catch(() => {})
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(auth).toBe('Bearer o')
  })
})

describe('question types for AI', () => {
  it('a queued job with an old type generates only allowed types', async () => {
    const prompts: string[] = []
    const call: ModelCall = async ({ prompt }) => {
      prompts.push(prompt)
      return { questions: [question(prompts.length)] }
    }
    await generateQuestions({ ...REQUEST, count: 2, types: ['table_fill', 'short_answer'] }, { models: [FIRST], callModel: call })
    expect(prompts.join('\n')).not.toContain('table_fill')
    expect(prompts.join('\n')).toContain('short_answer')
  })

  it('without a single allowed type it uses all allowed ones', async () => {
    const prompts: string[] = []
    const call: ModelCall = async ({ prompt }) => {
      prompts.push(prompt)
      return { questions: [question(prompts.length)] }
    }
    await generateQuestions({ ...REQUEST, count: 3, types: ['table_fill'] }, { models: [FIRST], callModel: call })
    expect(prompts.join('\n')).not.toContain('table_fill')
    expect(prompts.join('\n')).toContain('single_choice')
  })
})

describe('quote check during generation', () => {
  it('drops a question whose quote is not in the material and keeps the others', async () => {
    const call: ModelCall = async () => ({
      questions: [
        { ...question(1), evidence: { fileName: 'x', quote: 'Koloběh vody v přírodě zahrnuje výpar' } },
        { ...question(2), evidence: { fileName: 'x', quote: 'Voda vře při sto stupních.' } },
      ],
    })
    const result = await generateQuestions(
      { ...REQUEST, count: 2, types: [...REQUEST.types] },
      { models: [FIRST], callModel: call },
    )
    expect(result.questions.map((q) => (q.payload as { prompt: string }).prompt)).toEqual(['Otázka číslo 1?'])
    expect(result.rejected[0]?.errors).toContain('citace v evidence se v materiálu nenašla')
  })
})

describe('duplicates', () => {
  it('saves a prompt differing only in case and punctuation just once', async () => {
    const wording = ['Co je výpar?', 'co je výpar', 'Co je  výpar ?']
    const call: ModelCall = async () => ({
      questions: wording.map(
        (prompt) =>
          ({ ...question(0), payload: { prompt, answer: 'odpověď', acceptedAnswers: [] } }) as QuestionContent,
      ),
    })
    const result = await generateQuestions(
      { ...REQUEST, count: 3, types: [...REQUEST.types] },
      { models: [FIRST], callModel: call },
    )
    expect(result.questions).toHaveLength(1)
  })

  it('does not save again a question already in the topic', async () => {
    const call: ModelCall = async () => ({
      questions: [
        { ...question(0), payload: { prompt: 'Co je výpar?', answer: 'odpověď', acceptedAnswers: [] } } as QuestionContent,
      ],
    })
    const result = await generateQuestions(
      { ...REQUEST, count: 1, types: [...REQUEST.types], avoid: ['co je VÝPAR'] },
      { models: [FIRST], callModel: call },
    )
    expect(result.questions).toHaveLength(0)
  })
})

/**
 * A topic of `count` files; each file is its own chunk (a new header always
 * starts a new chunk), so the prompt shows which chunk the model got.
 */
function topicAboutFiles(count: number): string {
  return Array.from(
    { length: count },
    (_, i) => `=== soubor${i}.txt ===\n${`Kapitola číslo ${i} vypráví o vodě a jejím koloběhu v přírodě. `.repeat(25)}`,
  ).join('\n\n')
}

/** Which files (chunks) appeared in the prompts. */
function filesInPrompts(prompts: string[]): number[] {
  return [...new Set(prompts.flatMap((p) => [...p.matchAll(/=== soubor(\d+)\.txt ===/g)].map((m) => Number(m[1]))))].sort(
    (a, b) => a - b,
  )
}

function recordingModel(): { call: ModelCall; prompts: string[] } {
  const prompts: string[] = []
  let order = 0
  const call: ModelCall = async ({ prompt }) => {
    prompts.push(prompt)
    // Returns exactly as many questions as the prompt asked for — like an obedient model.
    const count = Number(/Vytvoř přesně (\d+) otázek/.exec(prompt)?.[1] ?? 0)
    return { questions: Array.from({ length: count }, () => question(++order)) }
  }
  return { call, prompts }
}

describe('chunk selection during generation', () => {
  it('ten questions from thirty chunks cost only two model calls', async () => {
    const { call, prompts } = recordingModel()
    const result = await generateQuestions(
      { ...REQUEST, text: topicAboutFiles(30), count: 10, types: [...REQUEST.types] },
      { models: [FIRST], callModel: call },
    )
    expect(prompts).toHaveLength(2)
    expect(result.questions).toHaveLength(10)
    // Two calls, but from two different places in the material.
    expect(filesInPrompts(prompts)).toHaveLength(2)
  })

  it('a replacement quoting the third chunk gets exactly the third chunk', async () => {
    const { call, prompts } = recordingModel()
    await generateQuestions(
      {
        ...REQUEST,
        text: topicAboutFiles(10),
        count: 1,
        types: [...REQUEST.types],
        focus: 'Kapitola číslo 2 vypráví o vodě',
      },
      { models: [FIRST], callModel: call },
    )
    expect(filesInPrompts(prompts)).toEqual([2])
  })

  it('a replacement with a quote not in the material gets a chunk by the shift', async () => {
    const { call, prompts } = recordingModel()
    await generateQuestions(
      {
        ...REQUEST,
        text: topicAboutFiles(10),
        count: 1,
        types: [...REQUEST.types],
        focus: 'Tahle věta v materiálu vůbec není.',
        avoid: ['a', 'b', 'c'],
      },
      { models: [FIRST], callModel: call },
    )
    expect(filesInPrompts(prompts)).toEqual([3])
  })

  it('two top-ups with different "avoid" list lengths take different chunks', async () => {
    const first = recordingModel()
    await generateQuestions(
      { ...REQUEST, text: topicAboutFiles(30), count: 10, types: [...REQUEST.types] },
      { models: [FIRST], callModel: first.call },
    )
    const second = recordingModel()
    await generateQuestions(
      {
        ...REQUEST,
        text: topicAboutFiles(30),
        count: 10,
        types: [...REQUEST.types],
        avoid: Array.from({ length: 10 }, (_, i) => `Existující otázka ${i}?`),
      },
      { models: [FIRST], callModel: second.call },
    )
    const a = filesInPrompts(first.prompts)
    const b = filesInPrompts(second.prompts)
    expect(a).not.toEqual(b)
  })
})

describe('model setup description', () => {
  it('a working setup has no problems', () => {
    const setup = describeAiSetup({ AI_MODELS: 'google:gemini-flash-latest', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })
    expect(setup.ladder).toEqual([{ provider: 'google', model: 'gemini-flash-latest' }])
    expect(setup.problems).toEqual([])
  })

  it('names legacy variables and points to AI_MODELS', () => {
    const setup = describeAiSetup({ AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://x', ANTHROPIC_AUTH_TOKEN: '' })
    expect(setup.ladder).toEqual([])
    expect(setup.problems).toContain(
      'Proměnná AI_PROVIDER už se nepoužívá — model nastav v AI_MODELS (viz .env.example).',
    )
    expect(setup.problems).toContain(
      'Proměnná OLLAMA_BASE_URL už se nepoužívá — model nastav v AI_MODELS (viz .env.example).',
    )
    // An empty variable does not count — it sets nothing.
    expect(setup.problems.join('\n')).not.toContain('ANTHROPIC_AUTH_TOKEN')
  })

  it('reports an item with an unknown provider or without a prefix', () => {
    const setup = describeAiSetup({ AI_MODELS: 'ollama:qwen3:14b, gemini-flash-latest', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })
    expect(setup.problems).toEqual([
      'Položka „ollama:qwen3:14b" v AI_MODELS nemá známého poskytovatele (google, openrouter, anthropic).',
      'Položka „gemini-flash-latest" v AI_MODELS nemá známého poskytovatele (google, openrouter, anthropic).',
    ])
  })

  it('reports an item without a key including the key variable name', () => {
    const setup = describeAiSetup({ AI_MODELS: 'anthropic:claude-haiku-4-5, google:gemini-flash-latest', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })
    expect(setup.ladder).toEqual([{ provider: 'google', model: 'gemini-flash-latest' }])
    expect(setup.problems).toEqual(['K položce „anthropic:claude-haiku-4-5" chybí klíč ANTHROPIC_API_KEY.'])
  })

  it('without AI_MODELS and without a key it says the default model\'s key is missing', () => {
    expect(describeAiSetup({}).problems).toEqual([
      'K položce „google:gemini-flash-latest" chybí klíč GOOGLE_GENERATIVE_AI_API_KEY.',
    ])
  })

  it('AI_MODELS with only separators reports that it is empty', () => {
    const setup = describeAiSetup({ AI_MODELS: ' , ', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })
    expect(setup.ladder).toEqual([])
    expect(setup.problems).toEqual(['V AI_MODELS není žádná položka poskytovatel:model.'])
  })

  it('the ladder is the same as from readAiLadder', () => {
    const env = { AI_MODELS: 'google:a, google:a, openrouter:b', GOOGLE_GENERATIVE_AI_API_KEY: 'g', OPENROUTER_API_KEY: 'o' }
    expect(describeAiSetup(env).ladder).toEqual(readAiLadder(env))
  })

  it('the message for unconfigured generation says what to add', () => {
    expect(aiNotConfiguredMessage()).toContain('AI_MODELS')
    expect(aiNotConfiguredMessage()).toContain('GOOGLE_GENERATIVE_AI_API_KEY')
    expect(aiNotConfiguredMessage()).toContain('OPENROUTER_API_KEY')
    expect(aiNotConfiguredMessage()).toContain('ANTHROPIC_API_KEY')
  })
})
