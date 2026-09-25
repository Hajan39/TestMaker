import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/generate/route'
import { AI_NOT_CONFIGURED_MESSAGE } from '@testmaker/core/ai'
import { aiStatus } from '@/lib/ai'
import { jsonReq } from './helpers'

/** Prostředí bez jakéhokoli klíče k modelu. */
function withoutKeys(): void {
  vi.stubEnv('AI_MODELS', '')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
  vi.stubEnv('OPENROUTER_API_KEY', '')
  for (const legacy of ['AI_PROVIDER', 'AI_MODEL', 'OLLAMA_WORKERS', 'OLLAMA_BASE_URL', 'OLLAMA_CONCURRENCY']) {
    vi.stubEnv(legacy, '')
  }
}

/** Prostředí s klíčem — samotné volání modelu testy nespouštějí. */
function withKey(): void {
  withoutKeys()
  vi.stubEnv('AI_MODELS', 'anthropic:claude-opus-5')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('generování bez klíče k modelu', () => {
  it('odpoví 503 a vysvětlí, co doplnit', async () => {
    withoutKeys()
    const response = await POST(jsonReq('/api/generate', 'POST', { topicId: 'cokoli' }))

    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: string }
    // Hláška je pro učitelku, ne pro vývojáře — musí říct, co s tím.
    expect(body.error).toBe(AI_NOT_CONFIGURED_MESSAGE)
  })

  it('503 má přednost před kontrolou dat — bez klíče se negeneruje tak jako tak', async () => {
    withoutKeys()
    const response = await POST(jsonReq('/api/generate', 'POST', {}))
    expect(response.status).toBe(503)
  })

  it('stav pro rozhraní hlásí, že nakonfigurováno není', () => {
    withoutKeys()
    expect(aiStatus().configured).toBe(false)
  })

  it('stav pro rozhraní vysvětlí, proč nastavené není', () => {
    withoutKeys()
    vi.stubEnv('AI_PROVIDER', 'ollama')
    vi.stubEnv('AI_MODELS', 'anthropic:claude-haiku-4-5')
    expect(aiStatus().problems).toEqual([
      'Proměnná AI_PROVIDER už se nepoužívá — model nastav v AI_MODELS (viz .env.example).',
      'K položce „anthropic:claude-haiku-4-5" chybí klíč ANTHROPIC_API_KEY.',
    ])
  })

  it('s klíčem se stav hlásí jako nakonfigurovaný a je vidět model', () => {
    withKey()
    const status = aiStatus()
    expect(status.configured).toBe(true)
    expect(status.provider).toBe('Anthropic')
    expect(status.model).toBeTruthy()
  })
})

describe('kontrola vstupů generování', () => {
  it('bez tématu je to 400', async () => {
    withKey()
    const response = await POST(jsonReq('/api/generate', 'POST', {}))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Neplatná data' })
  })

  it('odmítne počet otázek mimo rozsah', async () => {
    withKey()
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', count: 0 }))).status).toBe(400)
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', count: 61 }))).status).toBe(400)
  })

  it('odmítne neznámý typ otázky i prázdný seznam typů', async () => {
    withKey()
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', types: ['křížovka'] }))).status).toBe(400)
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', types: [] }))).status).toBe(400)
  })

  it('odmítne obtížnost, která neexistuje', async () => {
    withKey()
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', difficulty: 9 }))).status).toBe(400)
  })
})
