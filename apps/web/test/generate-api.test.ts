import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/generate/route'
import { aiNotConfiguredMessage } from '@testmaker/core/ai'
import { aiStatus } from '@/lib/ai'
import { jsonReq } from './helpers'

/** Environment without any model key. */
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

/** Environment with a key — the tests never call the model itself. */
function withKey(): void {
  withoutKeys()
  vi.stubEnv('AI_MODELS', 'anthropic:claude-opus-5')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('generation without a model key', () => {
  it('responds 503 and explains what to add', async () => {
    withoutKeys()
    const response = await POST(jsonReq('/api/generate', 'POST', { topicId: 'cokoli' }))

    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: string }
    // The message is for the teacher, not a developer — it must say what to do.
    expect(body.error).toBe(aiNotConfiguredMessage())
  })

  it('503 takes precedence over input validation — without a key nothing generates anyway', async () => {
    withoutKeys()
    const response = await POST(jsonReq('/api/generate', 'POST', {}))
    expect(response.status).toBe(503)
  })

  it('UI status reports it is not configured', () => {
    withoutKeys()
    expect(aiStatus().configured).toBe(false)
  })

  it('UI status explains why it is not configured', () => {
    withoutKeys()
    vi.stubEnv('AI_PROVIDER', 'ollama')
    vi.stubEnv('AI_MODELS', 'anthropic:claude-haiku-4-5')
    expect(aiStatus().problems).toEqual([
      'Proměnná AI_PROVIDER už se nepoužívá — model nastav v AI_MODELS (viz .env.example).',
      'K položce „anthropic:claude-haiku-4-5" chybí klíč ANTHROPIC_API_KEY.',
    ])
  })

  it('with a key the status reports configured and shows the model', () => {
    withKey()
    const status = aiStatus()
    expect(status.configured).toBe(true)
    expect(status.provider).toBe('Anthropic')
    expect(status.model).toBeTruthy()
  })
})

describe('generation input validation', () => {
  it('returns 400 without a topic', async () => {
    withKey()
    const response = await POST(jsonReq('/api/generate', 'POST', {}))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Požadavek nešel zpracovat. Obnov stránku a zkus to znovu.' })
  })

  it('rejects a question count out of range', async () => {
    withKey()
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', count: 0 }))).status).toBe(400)
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', count: 61 }))).status).toBe(400)
  })

  it('rejects an unknown question type and an empty type list', async () => {
    withKey()
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', types: ['křížovka'] }))).status).toBe(400)
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', types: [] }))).status).toBe(400)
  })

  it('rejects a difficulty that does not exist', async () => {
    withKey()
    expect((await POST(jsonReq('/api/generate', 'POST', { topicId: 't', difficulty: 9 }))).status).toBe(400)
  })
})
