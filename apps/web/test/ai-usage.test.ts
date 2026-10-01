import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/administrace/ai/route'
import { aiCalls, db, schools, users } from '@/db'
import {
  periodFrom,
  aiUsageOverview,
  cleanupOldCalls,
  recordCall,
  type AiTask,
} from '@/lib/aiUsage'
import { TABLE_ORDER } from '@/lib/backup'
import { generateForTopic } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { suggestPuzzleWords } from '@/lib/puzzles'
import type { Scope } from '@/lib/user'
import { req, seedMaterial, seedTopic, ACCOUNT } from './helpers'
import { TEST_SCHOOL_ID } from './setup'

/**
 * The "AI usage" overview in administration: recording every model call attempt
 * and aggregating by model, task, school and day. Rows are inserted directly here
 * so the creation date can be controlled.
 */

const NOW = Date.parse('2026-09-30T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ADMIN: Scope = { schoolId: TEST_SCHOOL_ID, userId: ACCOUNT.userId, role: 'administrator' }
const SECOND_SCHOOL = 'skola-druha-ai-pouziti'

async function calls(options: {
  model?: string
  outcome?: 'ok' | 'limit' | 'bad_shape' | 'error'
  task?: AiTask
  schoolId?: string
  before?: number
  input?: number | null
  output?: number | null
}) {
  await db.insert(aiCalls).values({
    id: newId(),
    schoolId: options.schoolId ?? TEST_SCHOOL_ID,
    userId: null,
    task: options.task ?? 'otazky',
    model: options.model ?? 'google:a',
    outcome: options.outcome ?? 'ok',
    inputTokens: options.input === undefined ? 100 : options.input,
    outputTokens: options.output === undefined ? 10 : options.output,
    durationMs: 1200,
    createdAt: new Date(NOW - (options.before ?? 0)).toISOString(),
  })
}

beforeEach(async () => {
  await db.delete(aiCalls)
  await db.insert(schools).values({ id: SECOND_SCHOOL, name: 'Druhá škola', slug: 'druha-ai' }).onConflictDoNothing()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('AI usage overview', () => {
  it('gives nothing to roles other than administrator', async () => {
    await calls({})
    expect(await aiUsageOverview({ ...ADMIN, role: 'ucitelka' }, 30, { now: NOW })).toBeNull()
    expect(await aiUsageOverview({ ...ADMIN, role: 'spravce' }, 30, { now: NOW })).toBeNull()
  })

  it('sums per model including outcomes and tokens', async () => {
    await calls({ model: 'google:a', outcome: 'ok', input: 100, output: 10, before: 2 * DAY })
    await calls({ model: 'google:a', outcome: 'limit', input: null, output: null, before: DAY })
    await calls({ model: 'google:a', outcome: 'bad_shape' })
    await calls({ model: 'openrouter:b', outcome: 'error', input: null, output: null })

    const overview = await aiUsageOverview(ADMIN, 30, { now: NOW })
    expect(overview?.total).toBe(4)
    expect(overview?.models).toEqual([
      {
        model: 'google:a',
        calls: 3,
        ok: 1,
        limit: 1,
        badShape: 1,
        error: 0,
        input: 200,
        output: 20,
        lastAt: new Date(NOW).toISOString(),
      },
      {
        model: 'openrouter:b',
        calls: 1,
        ok: 0,
        limit: 0,
        badShape: 0,
        error: 1,
        input: 0,
        output: 0,
        lastAt: new Date(NOW).toISOString(),
      },
    ])
  })

  it('always lists all three tasks, even without calls', async () => {
    await calls({ task: 'hlavolam' })
    await calls({ task: 'hlavolam' })
    const overview = await aiUsageOverview(ADMIN, 30, { now: NOW })
    expect(overview?.tasks).toEqual([
      { task: 'otazky', calls: 0, input: 0, output: 0 },
      { task: 'hlavolam', calls: 2, input: 200, output: 20 },
      { task: 'list', calls: 0, input: 0, output: 0 },
    ])
  })

  it('sums across schools', async () => {
    await calls({})
    await calls({ schoolId: SECOND_SCHOOL })
    await calls({ schoolId: SECOND_SCHOOL })
    const overview = await aiUsageOverview(ADMIN, 30, { now: NOW })
    expect(overview?.schools).toEqual([
      { schoolId: SECOND_SCHOOL, name: 'Druhá škola', calls: 2, input: 200, output: 20 },
      { schoolId: TEST_SCHOOL_ID, name: 'Testovací škola', calls: 1, input: 100, output: 10 },
    ])
  })

  it('the daily series has every day of the period, even empty ones', async () => {
    await calls({ outcome: 'ok' })
    await calls({ outcome: 'limit' })
    await calls({ outcome: 'error', before: 2 * DAY })
    const overview = await aiUsageOverview(ADMIN, 7, { now: NOW })
    expect(overview?.dayRows).toHaveLength(7)
    expect(overview?.dayRows[0]?.day).toBe('2026-09-24')
    expect(overview?.dayRows.at(-1)).toEqual({ day: '2026-09-30', ok: 1, limit: 1, others: 0 })
    expect(overview?.dayRows.at(-3)).toEqual({ day: '2026-09-28', ok: 0, limit: 0, others: 1 })
    expect(overview?.dayRows.at(-2)).toEqual({ day: '2026-09-29', ok: 0, limit: 0, others: 0 })
  })

  it('older calls do not belong to the period', async () => {
    await calls({ before: 10 * DAY })
    const overview = await aiUsageOverview(ADMIN, 7, { now: NOW })
    expect(overview?.total).toBe(0)
    expect(overview?.models).toEqual([])
    expect(overview?.schools).toEqual([])
    expect(overview?.dayRows.every((day) => day.ok + day.limit + day.others === 0)).toBe(true)
  })

  it('the ladder shows a model without a key too', async () => {
    vi.stubEnv('AI_MODELS', 'google:a,openrouter:b')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'klic')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const overview = await aiUsageOverview(ADMIN, 30, { now: NOW })
    expect(overview?.ladder).toEqual([
      { model: 'google:a', hasKey: true },
      { model: 'openrouter:b', hasKey: false },
    ])
  })

  it('an unknown period falls back to 30 days', () => {
    expect(periodFrom('7')).toBe(7)
    expect(periodFrom('90')).toBe(90)
    expect(periodFrom('abc')).toBe(30)
    expect(periodFrom('365')).toBe(30)
    expect(periodFrom(null)).toBe(30)
  })
})

describe('recording calls', () => {
  it('stores a call attempt', async () => {
    await recordCall({ schoolId: TEST_SCHOOL_ID, userId: ACCOUNT.userId }, 'otazky', {
      model: 'google:a',
      outcome: 'ok',
      inputTokens: 5,
      outputTokens: 6,
      durationMs: 12.7,
    })
    expect(await db.select().from(aiCalls)).toMatchObject([
      { schoolId: TEST_SCHOOL_ID, userId: ACCOUNT.userId, task: 'otazky', inputTokens: 5, outputTokens: 6, durationMs: 13 },
    ])
  })

  it('a write error does not break generation', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      recordCall({ schoolId: 'neexistujici-skola', userId: null }, 'otazky', {
        model: 'google:a',
        outcome: 'ok',
        inputTokens: null,
        outputTokens: null,
        durationMs: 1,
      }),
    ).resolves.toBeUndefined()
    error.mockRestore()
  })

  it('cleanup deletes records older than 400 days', async () => {
    await calls({ model: 'stary', before: 401 * DAY })
    await calls({ model: 'mladsi', before: 399 * DAY })
    expect(await cleanupOldCalls(NOW)).toBe(1)
    expect((await db.select().from(aiCalls)).map((row) => row.model)).toEqual(['mladsi'])
  })

  it('the school backup does not carry the table', () => {
    expect(TABLE_ORDER).not.toContain('ai_calls')
  })
})

describe('GET /api/administrace/ai', () => {
  async function asRole(role: 'administrator' | 'ucitelka') {
    const id = newId()
    await db.insert(users).values({ id, schoolId: TEST_SCHOOL_ID, email: `${id}@localhost`, name: `Účet ${id}`, role })
    vi.stubEnv('E2E_UZIVATEL', id)
  }

  it('the administrator gets the overview, an unknown period falls back to 30 days', async () => {
    await asRole('administrator')
    await calls({ before: 0 })
    const response = await GET(req('/api/administrace/ai?dni=abc'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { days: number; dayRows: unknown[] }
    expect(body.days).toBe(30)
    expect(body.dayRows).toHaveLength(30)
  })

  it('a teacher gets 404', async () => {
    await asRole('ucitelka')
    const response = await GET(req('/api/administrace/ai'))
    expect(response.status).toBe(404)
  })
})

const EVENT ={ model: 'google:a', outcome: 'ok', inputTokens: 1, outputTokens: 2, durationMs: 3 } as const

describe('wiring into generation', () => {
  it('topic questions record the call under the signed-in teacher', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: 'Fotosyntéza probíhá v listech rostlin. '.repeat(20) })
    await generateForTopic(ACCOUNT, topicId, { count: 1, types: ['single_choice'], difficulty: 2 }, {
      generate: async (_request, options) => {
        options?.onCall?.(EVENT)
        return { questions: [], rejected: [], chunks: 1, failedCalls: [], models: [] }
      },
    })
    await vi.waitFor(async () => {
      expect(await db.select().from(aiCalls)).toMatchObject([
        { schoolId: TEST_SCHOOL_ID, userId: ACCOUNT.userId, task: 'otazky', model: 'google:a' },
      ])
    })
  })

  it('puzzle words are recorded as a puzzle', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: 'Houba roste v lese a má klobouk. '.repeat(20) })
    await suggestPuzzleWords(ACCOUNT, topicId, {
      kind: 'wordsearch',
      count: 1,
      generate: async (_request, options) => {
        options?.onCall?.(EVENT)
        return { entries: [], rejected: [], adjusted: [], models: ['google:a'], stats: { requested: 1, returned: 0, usable: 0, dropped: 0 } }
      },
    })
    await vi.waitFor(async () => {
      expect(await db.select().from(aiCalls)).toMatchObject([{ userId: ACCOUNT.userId, task: 'hlavolam' }])
    })
  })
})
