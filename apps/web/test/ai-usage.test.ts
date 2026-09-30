import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiCalls, db, schools } from '@/db'
import {
  obdobiZ,
  prehledPouzitiAi,
  uklidStarychVolani,
  zapsatVolani,
  type UlohaAi,
} from '@/lib/aiUsage'
import { PORADI } from '@/lib/backup'
import { generateForTopic } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { suggestPuzzleWords } from '@/lib/puzzles'
import type { Scope } from '@/lib/uzivatel'
import { seedMaterial, seedTopic, UCET } from './helpers'
import { TEST_SKOLA_ID } from './setup'

/**
 * Přehled „Použití AI“ v administraci: záznam každého pokusu o volání modelu
 * a jeho agregace podle modelu, úlohy, školy a dne. Řádky se tu vkládají
 * přímo, aby šlo řídit datum vzniku.
 */

const TED = Date.parse('2026-09-30T12:00:00.000Z')
const DEN = 24 * 60 * 60 * 1000
const ADMIN: Scope = { schoolId: TEST_SKOLA_ID, userId: UCET.userId, role: 'administrator' }
const DRUHA_SKOLA = 'skola-druha-ai-pouziti'

async function volani(options: {
  model?: string
  outcome?: 'ok' | 'limit' | 'bad_shape' | 'error'
  task?: UlohaAi
  schoolId?: string
  pred?: number
  input?: number | null
  output?: number | null
}) {
  await db.insert(aiCalls).values({
    id: newId(),
    schoolId: options.schoolId ?? TEST_SKOLA_ID,
    userId: null,
    task: options.task ?? 'otazky',
    model: options.model ?? 'google:a',
    outcome: options.outcome ?? 'ok',
    inputTokens: options.input === undefined ? 100 : options.input,
    outputTokens: options.output === undefined ? 10 : options.output,
    durationMs: 1200,
    createdAt: new Date(TED - (options.pred ?? 0)).toISOString(),
  })
}

beforeEach(async () => {
  await db.delete(aiCalls)
  await db.insert(schools).values({ id: DRUHA_SKOLA, name: 'Druhá škola', slug: 'druha-ai' }).onConflictDoNothing()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('přehled použití AI', () => {
  it('jiné role než administrátor nic nedostanou', async () => {
    await volani({})
    expect(await prehledPouzitiAi({ ...ADMIN, role: 'ucitelka' }, 30, { now: TED })).toBeNull()
    expect(await prehledPouzitiAi({ ...ADMIN, role: 'spravce' }, 30, { now: TED })).toBeNull()
  })

  it('sčítá podle modelu včetně výsledků a tokenů', async () => {
    await volani({ model: 'google:a', outcome: 'ok', input: 100, output: 10, pred: 2 * DEN })
    await volani({ model: 'google:a', outcome: 'limit', input: null, output: null, pred: DEN })
    await volani({ model: 'google:a', outcome: 'bad_shape' })
    await volani({ model: 'openrouter:b', outcome: 'error', input: null, output: null })

    const prehled = await prehledPouzitiAi(ADMIN, 30, { now: TED })
    expect(prehled?.celkem).toBe(4)
    expect(prehled?.modely).toEqual([
      {
        model: 'google:a',
        volani: 3,
        ok: 1,
        limit: 1,
        badShape: 1,
        error: 0,
        vstup: 200,
        vystup: 20,
        naposledy: new Date(TED).toISOString(),
      },
      {
        model: 'openrouter:b',
        volani: 1,
        ok: 0,
        limit: 0,
        badShape: 0,
        error: 1,
        vstup: 0,
        vystup: 0,
        naposledy: new Date(TED).toISOString(),
      },
    ])
  })

  it('úlohy jsou vždy všechny tři, i bez volání', async () => {
    await volani({ task: 'hlavolam' })
    await volani({ task: 'hlavolam' })
    const prehled = await prehledPouzitiAi(ADMIN, 30, { now: TED })
    expect(prehled?.ulohy).toEqual([
      { task: 'otazky', volani: 0, vstup: 0, vystup: 0 },
      { task: 'hlavolam', volani: 2, vstup: 200, vystup: 20 },
      { task: 'list', volani: 0, vstup: 0, vystup: 0 },
    ])
  })

  it('sčítá napříč školami', async () => {
    await volani({})
    await volani({ schoolId: DRUHA_SKOLA })
    await volani({ schoolId: DRUHA_SKOLA })
    const prehled = await prehledPouzitiAi(ADMIN, 30, { now: TED })
    expect(prehled?.skoly).toEqual([
      { schoolId: DRUHA_SKOLA, nazev: 'Druhá škola', volani: 2, vstup: 200, vystup: 20 },
      { schoolId: TEST_SKOLA_ID, nazev: 'Testovací škola', volani: 1, vstup: 100, vystup: 10 },
    ])
  })

  it('denní řada má každý den období, i prázdný', async () => {
    await volani({ outcome: 'ok' })
    await volani({ outcome: 'limit' })
    await volani({ outcome: 'error', pred: 2 * DEN })
    const prehled = await prehledPouzitiAi(ADMIN, 7, { now: TED })
    expect(prehled?.dny).toHaveLength(7)
    expect(prehled?.dny[0]?.den).toBe('2026-09-24')
    expect(prehled?.dny.at(-1)).toEqual({ den: '2026-09-30', ok: 1, limit: 1, ostatni: 0 })
    expect(prehled?.dny.at(-3)).toEqual({ den: '2026-09-28', ok: 0, limit: 0, ostatni: 1 })
    expect(prehled?.dny.at(-2)).toEqual({ den: '2026-09-29', ok: 0, limit: 0, ostatni: 0 })
  })

  it('starší volání do období nepatří', async () => {
    await volani({ pred: 10 * DEN })
    const prehled = await prehledPouzitiAi(ADMIN, 7, { now: TED })
    expect(prehled?.celkem).toBe(0)
    expect(prehled?.modely).toEqual([])
    expect(prehled?.skoly).toEqual([])
    expect(prehled?.dny.every((den) => den.ok + den.limit + den.ostatni === 0)).toBe(true)
  })

  it('žebříček ukáže i model bez klíče', async () => {
    vi.stubEnv('AI_MODELS', 'google:a,openrouter:b')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'klic')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const prehled = await prehledPouzitiAi(ADMIN, 30, { now: TED })
    expect(prehled?.zebricek).toEqual([
      { model: 'google:a', maKlic: true },
      { model: 'openrouter:b', maKlic: false },
    ])
  })

  it('neznámé období spadne na 30 dní', () => {
    expect(obdobiZ('7')).toBe(7)
    expect(obdobiZ('90')).toBe(90)
    expect(obdobiZ('abc')).toBe(30)
    expect(obdobiZ('365')).toBe(30)
    expect(obdobiZ(null)).toBe(30)
  })
})

describe('zápis volání', () => {
  it('uloží pokus o volání', async () => {
    await zapsatVolani({ schoolId: TEST_SKOLA_ID, userId: UCET.userId }, 'otazky', {
      model: 'google:a',
      outcome: 'ok',
      inputTokens: 5,
      outputTokens: 6,
      durationMs: 12.7,
    })
    expect(await db.select().from(aiCalls)).toMatchObject([
      { schoolId: TEST_SKOLA_ID, userId: UCET.userId, task: 'otazky', inputTokens: 5, outputTokens: 6, durationMs: 13 },
    ])
  })

  it('chyba zápisu generování neshodí', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      zapsatVolani({ schoolId: 'neexistujici-skola', userId: null }, 'otazky', {
        model: 'google:a',
        outcome: 'ok',
        inputTokens: null,
        outputTokens: null,
        durationMs: 1,
      }),
    ).resolves.toBeUndefined()
    error.mockRestore()
  })

  it('úklid smaže záznamy starší než 400 dní', async () => {
    await volani({ model: 'stary', pred: 401 * DEN })
    await volani({ model: 'mladsi', pred: 399 * DEN })
    expect(await uklidStarychVolani(TED)).toBe(1)
    expect((await db.select().from(aiCalls)).map((row) => row.model)).toEqual(['mladsi'])
  })

  it('záloha školy tabulku nepřenáší', () => {
    expect(PORADI).not.toContain('ai_calls')
  })
})

const UDALOST = { model: 'google:a', outcome: 'ok', inputTokens: 1, outputTokens: 2, durationMs: 3 } as const

describe('zapojení do generování', () => {
  it('otázky tématu zapíšou volání pod přihlášenou učitelku', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: 'Fotosyntéza probíhá v listech rostlin. '.repeat(20) })
    await generateForTopic(UCET, topicId, { count: 1, types: ['single_choice'], difficulty: 2 }, {
      generate: async (_request, options) => {
        options?.onCall?.(UDALOST)
        return { questions: [], rejected: [], chunks: 1, failedCalls: [], models: [] }
      },
    })
    await vi.waitFor(async () => {
      expect(await db.select().from(aiCalls)).toMatchObject([
        { schoolId: TEST_SKOLA_ID, userId: UCET.userId, task: 'otazky', model: 'google:a' },
      ])
    })
  })

  it('slova do hlavolamu se zapíšou jako hlavolam', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: 'Houba roste v lese a má klobouk. '.repeat(20) })
    await suggestPuzzleWords(UCET, topicId, {
      kind: 'wordsearch',
      count: 1,
      generate: async (_request, options) => {
        options?.onCall?.(UDALOST)
        return { entries: [], rejected: [], adjusted: [], models: ['google:a'], stats: { requested: 1, returned: 0, usable: 0, dropped: 0 } }
      },
    })
    await vi.waitFor(async () => {
      expect(await db.select().from(aiCalls)).toMatchObject([{ userId: UCET.userId, task: 'hlavolam' }])
    })
  })
})
