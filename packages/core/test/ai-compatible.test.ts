import { generateText } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  describeAiConfig,
  getModel,
  isAiConfigured,
  readAiConfig,
  readAiLadder,
  readOpenAiCompatibleSettings,
} from '../src/ai/provider'

/**
 * Služby s rozhraním OpenAI (OpenRouter, Groq, Mistral, DeepInfra, Together
 * a vlastní adresa). Žádný test tady nesmí volat skutečnou službu — spojení se
 * podvrhuje přes `fetch`, takže se nespotřebuje ani kousek limitu.
 */

/** Podvržený `fetch`: zapamatuje si požadavek a vrátí odpověď ve tvaru OpenAI. */
function zachycenyFetch(): { fetch: typeof globalThis.fetch; pozadavky: { url: string; headers: Headers }[] } {
  const pozadavky: { url: string; headers: Headers }[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    pozadavky.push({ url: String(input), headers: new Headers(init?.headers) })
    return new Response(
      JSON.stringify({
        id: 'test',
        object: 'chat.completion',
        created: 0,
        model: 'testovací-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ahoj' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof globalThis.fetch
  return { fetch, pozadavky }
}

describe('nastavení služby s rozhraním OpenAI', () => {
  it('ke každé známé službě patří výchozí adresa, takže se URL nemusí opisovat', () => {
    expect(readOpenAiCompatibleSettings('openrouter', { OPENROUTER_API_KEY: 'or' })).toMatchObject({
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'or',
    })
    expect(readOpenAiCompatibleSettings('groq', { GROQ_API_KEY: 'gq' })?.baseURL).toBe('https://api.groq.com/openai/v1')
    expect(readOpenAiCompatibleSettings('mistral', { MISTRAL_API_KEY: 'mi' })?.baseURL).toBe('https://api.mistral.ai/v1')
    expect(readOpenAiCompatibleSettings('deepinfra', { DEEPINFRA_API_KEY: 'di' })?.baseURL).toBe(
      'https://api.deepinfra.com/v1/openai',
    )
    expect(readOpenAiCompatibleSettings('together', { TOGETHER_API_KEY: 'tg' })?.baseURL).toBe(
      'https://api.together.xyz/v1',
    )
  })

  it('adresu jde přebít z prostředí (vlastní proxy)', () => {
    const settings = readOpenAiCompatibleSettings('openrouter', {
      OPENROUTER_API_KEY: 'or',
      OPENROUTER_BASE_URL: 'https://proxy.doma/v1',
    })
    expect(settings?.baseURL).toBe('https://proxy.doma/v1')
  })

  it('bez klíče se služba použít nedá', () => {
    expect(readOpenAiCompatibleSettings('openrouter', {})).toBeNull()
    expect(readOpenAiCompatibleSettings('groq', { GROQ_API_KEY: '   ' })).toBeNull()
  })

  it('lokální server (custom) potřebuje jen adresu, klíč ne', () => {
    expect(readOpenAiCompatibleSettings('custom', {})).toBeNull()
    expect(readOpenAiCompatibleSettings('custom', { CUSTOM_BASE_URL: 'http://127.0.0.1:1234/v1' })).toMatchObject({
      baseURL: 'http://127.0.0.1:1234/v1',
      apiKey: undefined,
    })
  })
})

describe('žebříček napříč službami s rozhraním OpenAI', () => {
  it('položka určí službu a zbytek je celý název modelu — i s dvojtečkou v `:free`', () => {
    const env = {
      AI_MODELS: 'openrouter:nvidia/nemotron-3-super-120b-a12b:free, groq:llama-3.3-70b-versatile',
      OPENROUTER_API_KEY: 'or',
      GROQ_API_KEY: 'gq',
    }
    expect(readAiLadder(env)).toEqual([
      { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
      { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    ])
  })

  it('položka Ollamy s dvojtečkou v názvu modelu prochází dál stejně jako dřív', () => {
    const env = { AI_PROVIDER: 'ollama', AI_MODELS: 'ollama:qwen3:14b,qwen3:14b-instruct' }
    expect(readAiLadder(env).map(describeAiConfig)).toEqual(['ollama:qwen3:14b', 'ollama:qwen3:14b-instruct'])
  })

  it('položka služby bez klíče se ze žebříčku vynechá', () => {
    const env = {
      AI_MODELS: 'together:meta-llama/Llama-3.3-70B-Instruct-Turbo,openrouter:z-ai/glm-5.2:free',
      OPENROUTER_API_KEY: 'or',
    }
    expect(readAiLadder(env)).toEqual([{ provider: 'openrouter', model: 'z-ai/glm-5.2:free' }])
    expect(isAiConfigured(env)).toBe(true)
  })

  it('jeden klíč u jedné služby stačí na celý žebříček', () => {
    const env = {
      AI_MODELS: 'openrouter:z-ai/glm-5.2:free,openrouter:google/gemma-4-31b-it:free,openrouter:openai/gpt-oss-120b',
      OPENROUTER_API_KEY: 'or',
    }
    expect(readAiLadder(env)).toHaveLength(3)
    expect(isAiConfigured(env)).toBe(true)
  })

  it('žebříček bez jediného klíče generování nezapíná', () => {
    expect(isAiConfigured({ AI_MODELS: 'openrouter:z-ai/glm-5.2:free,groq:llama-3.3-70b-versatile' })).toBe(false)
  })

  it('bez AI_PROVIDER se služba pozná podle svého klíče a má výchozí model', () => {
    const config = readAiConfig({ OPENROUTER_API_KEY: 'or' })
    expect(config.provider).toBe('openrouter')
    expect(config.model).toBe('nvidia/nemotron-3-super-120b-a12b:free')
    expect(readAiConfig({ GROQ_API_KEY: 'gq' }).provider).toBe('groq')
    // Anthropic a Google mají pořád přednost, ať se dosavadní nastavení nezmění.
    expect(readAiConfig({ ANTHROPIC_API_KEY: 'sk', OPENROUTER_API_KEY: 'or' }).provider).toBe('anthropic')
  })

  it('AI_PROVIDER vybere službu výslovně a AI_MODEL přebije výchozí model', () => {
    const env = { AI_PROVIDER: 'deepinfra', AI_MODEL: 'Qwen/Qwen3.5-35B-A3B', DEEPINFRA_API_KEY: 'di' }
    expect(readAiConfig(env)).toEqual({ provider: 'deepinfra', model: 'Qwen/Qwen3.5-35B-A3B' })
  })
})

describe('sestavení modelu', () => {
  it('pošle požadavek na adresu služby a s jejím klíčem', async () => {
    const { fetch, pozadavky } = zachycenyFetch()
    const model = await getModel(
      { provider: 'openrouter', model: 'z-ai/glm-5.2:free' },
      { env: { OPENROUTER_API_KEY: 'klic-openrouteru' }, fetch },
    )

    await generateText({ model, prompt: 'ahoj', maxRetries: 0 })

    expect(pozadavky).toHaveLength(1)
    expect(pozadavky[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(pozadavky[0]?.headers.get('authorization')).toBe('Bearer klic-openrouteru')
  })

  it('u vlastní adresy (lokální server) jde požadavek tam a bez klíče', async () => {
    const { fetch, pozadavky } = zachycenyFetch()
    const model = await getModel(
      { provider: 'custom', model: 'qwen3-14b' },
      { env: { CUSTOM_BASE_URL: 'http://127.0.0.1:1234/v1' }, fetch },
    )

    await generateText({ model, prompt: 'ahoj', maxRetries: 0 })

    expect(pozadavky[0]?.url).toBe('http://127.0.0.1:1234/v1/chat/completions')
    expect(pozadavky[0]?.headers.get('authorization')).toBeNull()
  })

  it('bez klíče se model nesestaví a řekne, co do .env.local dopsat', async () => {
    await expect(getModel({ provider: 'groq', model: 'llama-3.3-70b-versatile' }, { env: {} })).rejects.toThrow(
      /GROQ_API_KEY/,
    )
  })
})
