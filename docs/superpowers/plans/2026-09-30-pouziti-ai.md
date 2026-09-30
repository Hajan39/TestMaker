# Použití AI v administraci — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every model call attempt is recorded in `ai_calls`, and the administrator sees a read-only "Použití AI" overview (ladder, per model / task / school / day) in `/administrace`.

**Architecture:** Core `startLadder` gets an optional `onCall` listener and hands the called function a `meter` for token usage; core stays DB-free. The web layer (`lib/aiUsage.ts`) turns a scope + task into an `onCall` that inserts rows, wires it into question and puzzle-word generation, and aggregates rows for the admin page (server component, period via `?dni=`) and `GET /api/administrace/ai`.

**Tech Stack:** TypeScript, Vercel AI SDK 7 (`generateObject` usage), drizzle-orm over libsql/SQLite, Next.js 16 App Router, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-pouziti-ai-design.md`

## Global Constraints

- UI texts and code comments in Czech; commits in English (Conventional Commits) ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Model calls only through `startLadder` / `objectCall` in `packages/core/src/ai/ladder.ts`; core must not depend on the DB or Next.js.
- `startLadder(models, signal?, onCall?)` — third parameter optional, existing callers compile unchanged.
- The listener must never break generation: exceptions from `onCall` are swallowed and logged; DB write errors are swallowed and logged.
- Abort (`AbortError` / aborted signal) is not recorded.
- No new migration — table `ai_calls` (`aiCalls`, `AiCallRow`) already exists from migration 0001.
- `ai_calls` is not part of the school backup (`lib/backup.ts` `TABULKY`) nor `push-remote.ts`.
- Rows older than 400 days are deleted on write, roughly once per 500 writes.
- Period: 7 / 30 / 90 days, default 30. Non-admin → `null` from `prehledPouzitiAi`, 404 from the API (also from `proxy.ts`, which today answers 403).
- Empty state text: „Zatím se nic negenerovalo. Záznamy se sbírají od nasazení této verze.“
- Colours only from existing tokens (`bg-brand`, `bg-draft-fg`, `bg-fg-muted`, …); no chart library, no new dependencies.
- Never touch `apps/web/local.db` or port 3000; e2e only via `playwright.login.config.ts` (port 3101).

## Review Focus

- A provider that returns no `usage` (or `undefined` token fields) → row with `null` tokens, sums treat it as 0. Test in Task 1 (meter with `undefined`) and Task 2 (null tokens in aggregation).
- Queue/cron runs have no signed-in user → `user_id` null, not the job's requester. Test in Task 3 (jobs-run).
- Unknown `?dni=` value (`abc`, `365`) → falls back to 30, no error. Test in Task 2 (`obdobiZ`) and Task 4 (API).
- Days with no calls must still appear in the daily series (zeros), and rows older than the window must not leak into any table. Test in Task 2.
- A teacher calling `/api/administrace/ai` must get 404 both from the route and from the proxy. Tests in Task 4.

---

### Task 1: Measurement in core

**Files:**
- Modify: `packages/core/src/ai/ladder.ts`
- Modify: `packages/core/src/ai/generate.ts` (options `onCall`, pass `meter`)
- Modify: `packages/core/src/ai/puzzleWords.ts` (options `onCall`, pass `meter`)
- Modify: `packages/core/src/ai/provider.ts` (add `listAiModels`)
- Test: `packages/core/test/ai-usage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AiCallEvent {
    model: string
    outcome: 'ok' | 'limit' | 'bad_shape' | 'error'
    inputTokens: number | null
    outputTokens: number | null
    durationMs: number
  }
  export type AiCallListener = (event: AiCallEvent) => void
  export interface CallMeter { usage(input: number | null | undefined, output: number | null | undefined): void }
  export function startLadder(models: AiConfig[], signal?: AbortSignal, onCall?: AiCallListener): LadderRun
  // LadderRun.call<T>(fn: (config: AiConfig, meter: CallMeter) => Promise<T>, options?)
  // ObjectCall / ModelCall / PuzzleWordsCall input gains `meter?: CallMeter`
  // generateQuestions / generatePuzzleWords options gain `onCall?: AiCallListener`
  export function listAiModels(env?: Env): { model: string; hasKey: boolean }[]
  ```

- [ ] **Step 1: Write the failing tests** (`packages/core/test/ai-usage.test.ts`)

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run (in `packages/core`): `npx pnpm@11.21.0 exec vitest run test/ai-usage.test.ts`
Expected: FAIL (`listAiModels` not exported, events empty / type errors).

- [ ] **Step 3: Implement**

`ladder.ts`: add the types above; in `call`, per attempt:

```ts
const started = Date.now()
const tokens: { input: number | null; output: number | null } = { input: null, output: null }
const meter: CallMeter = { usage(input, output) { tokens.input = input ?? null; tokens.output = output ?? null } }
try {
  const value = await fn(config, meter)
  report(key, 'ok', started, tokens)
  markUsed(key)
  return { value, model: key }
} catch (error) {
  if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw error
  const badShape = rawTextOf(error) !== null
  const retryable = describeAiError(error).retryable
  report(key, badShape ? 'bad_shape' : retryable ? 'limit' : 'error', started, tokens)
  if (badShape && !options.nextOnBadShape) { markUsed(key); throw error }
  if (!retryable) throw error
  exhausted.add(key)
  lastError = error
}
```

`report` calls `onCall` inside try/catch with `console.error('Záznam o volání modelu se nepodařilo předat:', error)`.
`objectCall`: input gets `meter?: CallMeter`; `const { object, usage } = await generateObject(...)`; `meter?.usage(usage?.inputTokens, usage?.outputTokens)`.
`generate.ts` / `puzzleWords.ts`: `ModelCall` / `PuzzleWordsCall` input gets `meter?: CallMeter`; options `onCall?: AiCallListener`; `startLadder(models, options.signal, options.onCall)`; `ladder.call((config, meter) => callModel({ config, system, prompt, signal: options.signal, meter }), …)`.
`provider.ts`: extract `ladderItems(env)` (AI_MODELS or defaults, trimmed, non-empty) used by `describeAiSetup`, and

```ts
export function listAiModels(env: Env = process.env): { model: string; hasKey: boolean }[] {
  const seen = new Set<string>()
  return ladderItems(env).flatMap((item) => {
    const config = parseModel(item)
    if (!config) return []
    const model = describeAiConfig(config)
    if (seen.has(model)) return []
    seen.add(model)
    return [{ model, hasKey: Boolean(apiKeyOf(config.provider, env)) }]
  })
}
```

- [ ] **Step 4: Run all core tests + typecheck**

Run: `npx pnpm@11.21.0 exec vitest run` and `npx pnpm@11.21.0 exec tsc --noEmit` in `packages/core`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): report every model call attempt to an optional listener`

---

### Task 2: Recording and overview query in web

**Files:**
- Create: `apps/web/src/lib/aiUsage.ts`
- Test: `apps/web/test/ai-usage.test.ts`

**Interfaces:**
- Consumes: `AiCallEvent`, `AiCallListener`, `listAiModels` from `@testmaker/core/ai`; `aiCalls`, `AiCallRow` from `@/db`.
- Produces:
  ```ts
  export type UlohaAi = AiCallRow['task']            // 'otazky' | 'hlavolam' | 'list'
  export interface Volajici { schoolId: string; userId: string | null }   // Scope fits
  export const OBDOBI_DNI: readonly [7, 30, 90]
  export type ObdobiDni = 7 | 30 | 90
  export function obdobiZ(value: unknown): ObdobiDni  // fallback 30
  export async function zapsatVolani(kdo: Volajici, task: UlohaAi, event: AiCallEvent): Promise<void>  // never throws
  export function zapisovatVolani(kdo: Volajici, task: UlohaAi): AiCallListener                      // fire-and-forget
  export async function uklidStarychVolani(now?: number): Promise<number>
  export async function prehledPouzitiAi(scope: Scope, dni: ObdobiDni, options?: { now?: number }): Promise<PrehledPouzitiAi | null>
  export interface PrehledPouzitiAi {
    dni: ObdobiDni
    celkem: number
    zebricek: { model: string; maKlic: boolean }[]
    modely: { model: string; volani: number; ok: number; limit: number; badShape: number; error: number; vstup: number; vystup: number; naposledy: string }[]
    ulohy: { task: UlohaAi; volani: number; vstup: number; vystup: number }[]   // always all three, fixed order
    skoly: { schoolId: string; nazev: string; volani: number; vstup: number; vystup: number }[]
    dny: { den: string; ok: number; limit: number; ostatni: number }[]         // exactly `dni` entries, oldest first
  }
  ```

- [ ] **Step 1: Write failing tests** covering: `null` for `ucitelka` / `spravce`; admin aggregates by model (outcome counts, null tokens as 0, `naposledy` = max created_at), task (three rows incl. zeros), school (names, across schools), day (length = dni, correct buckets, zeros); rows older than the window excluded; `zebricek` from `AI_MODELS` via `vi.stubEnv`; `obdobiZ('abc') === 30`, `obdobiZ('7') === 7`; `uklidStarychVolani` deletes 401-day-old and keeps 399-day-old; `zapsatVolani` resolves even for a non-existent school; `PORADI` does not contain `ai_calls`.

- [ ] **Step 2: Run** `npx pnpm@11.21.0 exec vitest run test/ai-usage.test.ts` in `apps/web` → FAIL (module missing).

- [ ] **Step 3: Implement** `aiUsage.ts` with four grouped SQL queries (`group by model`, `task`, `school_id` joined to `schools`, `substr(created_at, 1, 10)`) filtered by `created_at >= <first day>T00:00:00.000Z`, counts via `sum(case when outcome = … then 1 else 0 end)`, tokens via `coalesce(sum(…), 0)`, all `.mapWith(Number)`. Days filled in JS. `zapsatVolani` inserts, then `if (Math.random() < 1 / 500) await uklidStarychVolani()` with a `ponytail:` comment; everything in try/catch → `console.error`.

- [ ] **Step 4: Run** the test file and `tsc --noEmit` → PASS.

- [ ] **Step 5: Commit** — `feat(web): record AI calls and aggregate them for the administrator`

---

### Task 3: Wire recording into generation

**Files:**
- Modify: `apps/web/src/lib/generation.ts` (`generateForTopic`, `regenerateQuestion`, `createVariant`)
- Modify: `apps/web/src/app/api/jobs/run/route.ts`
- Modify: `apps/web/src/lib/puzzles.ts` (`suggestPuzzleWords`)
- Test: `apps/web/test/ai-usage.test.ts`, `apps/web/test/jobs-run.test.ts`

**Interfaces:**
- Consumes: `zapisovatVolani(kdo, task)` from Task 2.
- Produces: `generateForTopic(scope, topicId, params, { …, onCall?: AiCallListener })` — default `zapisovatVolani(scope, 'otazky')`; jobs/run passes `zapisovatVolani({ schoolId: job.schoolId, userId: null }, 'otazky')`. `regenerateQuestion` / `createVariant` pass `zapisovatVolani(scope, 'otazky')`; `suggestPuzzleWords` passes `zapisovatVolani(scope, 'hlavolam')`. `scripts/generate-bulk.ts` goes through `generateForTopic`, so it is covered without change.

- [ ] **Step 1: Failing tests**: `generateForTopic` with a `generate` stub that calls `options.onCall(event)` → a row with `task: 'otazky'`, `userId: UCET.userId` (use `vi.waitFor`); `suggestPuzzleWords` with a stub → `task: 'hlavolam'`; in `jobs-run.test.ts` the mocked `generateQuestions` calls `options.onCall` → row with `userId: null`.
- [ ] **Step 2: Run** → FAIL (no rows).
- [ ] **Step 3: Implement** the wiring above.
- [ ] **Step 4: Run** the web test suite → PASS (except known `migrace.test.ts` EPERM).
- [ ] **Step 5: Commit** — `feat(web): log model calls from question and puzzle word generation`

---

### Task 4: API and proxy 404

**Files:**
- Create: `apps/web/src/app/api/administrace/ai/route.ts`
- Modify: `apps/web/src/proxy.ts` (404 instead of 403 under `/api/administrace/`)
- Test: `apps/web/test/ai-usage.test.ts` (route), `apps/web/test/proxy.test.ts`

- [ ] **Step 1: Failing tests**: GET as administrator (`vi.stubEnv('E2E_UZIVATEL', adminId)`) → 200 with `dni: 30` for `?dni=abc`; as teacher → 404. Proxy: teacher cookie on `/api/administrace/ai` → 404.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```ts
export const runtime = 'nodejs'
export async function GET(request: Request) {
  return sRozsahem(async (ucet) => {
    const prehled = await prehledPouzitiAi(ucet, obdobiZ(new URL(request.url).searchParams.get('dni')))
    if (!prehled) return Response.json({ error: 'Nenalezeno' }, { status: 404 })
    return Response.json(prehled)
  })
}
```

Proxy: in the `!maPravo` branch, `if (pathname.startsWith('/api/administrace/')) return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 })` before the 403.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** — `feat(web): AI usage API for the administrator, hidden as 404 for others`

---

### Task 5: Overview UI, seed and e2e

**Files:**
- Create: `apps/web/src/app/administrace/PouzitiAi.tsx` (server component)
- Modify: `apps/web/src/app/administrace/page.tsx` (`searchParams.dni`, load overview)
- Modify: `apps/web/src/app/administrace/AdministraceScreen.tsx` (slot `pouzitiAi?: ReactNode` above „Nová škola“)
- Modify: `apps/web/scripts/seed-e2e.ts` (a few `ai_calls` rows in both schools)
- Modify: `apps/web/e2e/administrace.spec.ts`

**Interfaces:**
- Consumes: `prehledPouzitiAi`, `obdobiZ`, `OBDOBI_DNI`, `PrehledPouzitiAi` from Task 2.

UI content: heading „Použití AI“; period links `?dni=7|30|90` („7 dní“, „30 dní“, „90 dní“, `aria-current="page"` on the active one); ladder list in order, keyless ones with „přeskakuje se, chybí klíč“; if `celkem === 0` → `EmptyState` with the spec text; otherwise tables „Podle modelu“ (Model, Volání, Úspěšná, Limit, Nepoužitelná, Chyba, Tokeny vstup, Tokeny výstup, Naposledy), „Podle úlohy“ (Otázky / Hlavolamy / Pracovní listy), „Podle školy“, and „Po dnech“ bars (flex columns, heights proportional to the busiest day; `bg-brand` úspěch, `bg-draft-fg` limit, `bg-fg-muted` ostatní; `title` with the numbers; legend).

- [ ] **Step 1: e2e tests** (`administrace.spec.ts`): administrator opens `/administrace`, sees heading „Použití AI“ and the seeded model, clicks „7 dní“ → URL contains `dni=7`; teacher A: `page.request.get('/api/administrace/ai')` → 404.
- [ ] **Step 2: Implement** component, page, slot and seed rows.
- [ ] **Step 3: Verify**: `tsc --noEmit` (core, ui, web), `eslint` (web), `next build` (web), web + core vitest, `playwright test -c playwright.login.config.ts`.
- [ ] **Step 4: Commit** — `feat(web): AI usage overview in administration`
