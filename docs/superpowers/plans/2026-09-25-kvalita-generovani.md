# Úklid AI, kvalita generování a /otazky — plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cíl:** Všechno kolem AI nastavit na jednom místě (jeden žebříček modelů `AI_MODELS`, jeden soubor s konstantami, jedna složka s prompty, jedna smyčka volání modelu), vyhodit Ollamu a nepoužívané služby, opravit kvalitu generovaných otázek a přidat cestu přes Claude Code (`/otazky`) pro otázky v nejlepší češtině.

**Architektura:** V `packages/core/src/ai` vzniká `settings.ts` (konstanty), `ladder.ts` (žebříček modelů a volání `generateObject`) a složka `prompts/`; `provider.ts` zná jen Google, Anthropic (API klíč) a OpenRouter. `generateQuestions` má jedinou cestu a jedinou volbu `models`. Kontrola otázky (`checkQuestion`: tvar + doslovná citace) a deduplikace (`dedupeKey`) jsou čisté funkce, které používá generování i import souboru z Claude Code. Web dostává dvě routy (stažení materiálů tématu jako text, nahrání souboru s otázkami) a jednu malou komponentu; Claude Code skill `/otazky` volá dva skripty, které používají tatáž pravidla a tutéž kontrolu jako aplikace.

**Tech stack:** TypeScript, Next.js (App Router), AI SDK `ai` 7 (`generateObject`), `@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`, zod 4, vitest, tsx, Drizzle.

**Spec:** `docs/superpowers/specs/2026-09-25-zjednoduseni-ucitelka-design.md` — kapitoly „Kvalita generování" a „Nastavení AI a Claude Code".

## Globální omezení

- Kód, komentáře, texty v rozhraní i hlášky česky; commity anglicky podle Conventional Commits, zakončené řádkem `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Žádný test ani skript nesahá na `apps/web/local.db`; testy nevolají skutečný model (`callModel` / podvržený `fetch`).
- Tvar otázky určuje jediné zod schéma v `packages/core/src/schema`; žádná druhá definice.
- Poskytovatelé jsou jen `google`, `anthropic`, `openrouter`. Model se volí jedině přes `AI_MODELS` (`poskytovatel:model`, čárkou). Výchozí žebříček: `google:gemini-flash-latest`.
- Anthropic jen s `ANTHROPIC_API_KEY`. Přihlášení předplatným (OAuth, `ANTHROPIC_AUTH_TOKEN`, `pnpm dev:ant`) se odstraňuje — Anthropic ho mimo Claude Code odmítá.
- Úsek materiálu do jednoho volání má nejvýš 8 000 znaků. AI v aplikaci generuje jen `single_choice`, `true_false`, `short_answer`. Soubor z Claude Code smí obsahovat všechny typy kromě `label_image`.
- Rozpracované změny majitele v `packages/core/src/ai/puzzleWords.ts`, `packages/core/src/pdf/PuzzleBody.tsx` a `packages/ui/src/PaperPuzzle.tsx` se nestageují ani needitují. Úkol 3 na ně čeká. Do commitů jen vyjmenované soubory (`git add <soubor>`), nikdy `git add -A`.
- Ověření po každém úkolu: `pnpm test` (core i web) a `pnpm typecheck` v kořeni.
- `.env.local` obsahuje tajné klíče: nikdy nevypisovat hodnoty (ani `cat`), jen názvy proměnných.

## Na co si dát pozor při revizi

1. **Úloha z fronty se starými typy** (`matching`, `open`… uložené v `generation_jobs`) — generování je tiše zúží na povolené typy. Test v úkolu 5.
2. **Text z PDF bez prázdných řádků** — jeden obří „odstavec"; dělení musí padnout na řádky a věty. Test v úkolu 6.
3. **Dlouhý materiál a málo otázek** — otázky se nesmějí brát jen ze začátku materiálu. Test v úkolu 6.
4. **Citace s drobnou odchylkou** (uvozovky, tečka, „…", zalomení řádku) nesmí vést k zahození. Test v úkolu 7.
5. **Překlep v `AI_MODELS`** (`gemini-flash-latest` bez předpony, `ollama:…` z dřívějška) — položka se vynechá a zbytek žebříčku funguje; bez jediné platné položky se generování skryje, aplikace nespadne. Test v úkolu 2.

---

### Úkol 1: Jedna smyčka žebříčku a jedna cesta generování

**Soubory:**
- Vytvořit: `packages/core/src/ai/settings.ts`, `packages/core/src/ai/ladder.ts`
- Upravit: `packages/core/src/ai/generate.ts`, `packages/core/src/ai/prompt.ts`, `packages/core/src/ai/index.ts`
- Upravit: `apps/web/src/lib/generation.ts`, `apps/web/src/lib/questions.ts`, `apps/web/scripts/generate-bulk.ts`
- Test: `packages/core/test/ai-ladder.test.ts`

**Rozhraní:**
- Produkuje: `AI_SETTINGS` (objekt konstant), `startLadder(models: AiConfig[], signal?: AbortSignal): LadderRun`, `LadderRun = { used: string[]; call<T>(fn: (config: AiConfig) => Promise<T>, options?: { nextOnBadShape?: boolean }): Promise<{ value: T; model: string }> }`, `objectCall(schema)`, `rawTextOf(error): string | null`, `NO_MODEL_MESSAGE`.
- `generateQuestions(request, options?: { models?: AiConfig[]; signal?; onChunk?; onBatch?; callModel? })` — volby `config`, `configs`, `worker`, `workers` zanikají.
- `withDefaultPoints` se exportuje (použije ho úkol 10).

- [ ] **Krok 1: Upravit testy na novou volbu a přidat test prázdného žebříčku**

V `packages/core/test/ai-ladder.test.ts` nahradit všechna volání `generateQuestions(…, { configs: [...], … })` za `{ models: [...], … }` a `{ config: X, … }` za `{ models: [X], … }`. Smazat testy, které předávají `worker` nebo `workers` (paralelní Ollama workeři zanikají; `readOllamaWorkers` zatím zůstává v provideru, jeho testy smaže úkol 2). Na konec souboru přidat:

```ts
describe('žebříček bez modelů', () => {
  it('bez jediného modelu skončí srozumitelnou chybou', async () => {
    await expect(generateQuestions({ ...ZADANI, count: 1 }, { models: [] })).rejects.toThrow(/Žádný model/)
  })
})
```

- [ ] **Krok 2: Ověřit, že testy padají**

Spustit: `cd packages/core && pnpm exec vitest run test/ai-ladder.test.ts`
Očekávat: FAIL — `models` generování nezná (čte žebříček z prostředí), test prázdného žebříčku neprojde.

- [ ] **Krok 3: `settings.ts`**

```ts
/**
 * Nastavení generování na jednom místě. Co se tu změní, platí pro otázky
 * i hlavolamy, v aplikaci i ve skriptech. Model a klíče se nastavují
 * v prostředí (`AI_MODELS`, viz `.env.example`), ne tady.
 */
export const AI_SETTINGS = {
  /** Žebříček, když `AI_MODELS` chybí. */
  defaultModels: ['google:gemini-flash-latest'],
  /** Kolikrát AI SDK samo zopakuje neúspěšné volání jednoho modelu. */
  maxRetries: 2,
  /** Nejdelší úsek materiálu v jednom volání (znaky). */
  maxCharsPerCall: 120_000,
  /**
   * Otázek v jednom volání. Model vrací dávku jako jeden objekt — čím větší,
   * tím víc práce padne, když se u jedné otázky netrefí do tvaru.
   */
  questionsPerCall: 5,
  /**
   * Kolik zadání se vejde do seznamu „těmhle otázkám se vyhni". Podle téhož
   * čísla si web načítá existující otázky (`loadAvoidPrompts`).
   */
  avoidLimit: 80,
  /** Delší zadání v seznamu k vyhnutí se ořízne — k odlišení stačí začátek. */
  avoidItemMaxLength: 100,
  /** Víc bodů od modelu se nepřebírá (Gemini nabízelo i 25 za přiřazování). */
  maxAiPoints: 10,
} as const
```

- [ ] **Krok 4: `ladder.ts`**

```ts
import { generateObject, NoObjectGeneratedError, type LanguageModel } from 'ai'
import type { z } from 'zod'
import { describeAiError } from './errors'
import { describeAiConfig, getModel, type AiConfig } from './provider'
import { AI_SETTINGS } from './settings'

export const NO_MODEL_MESSAGE = 'Žádný model není nastavený. Doplň do .env.local klíč a případně AI_MODELS.'

/** Vytáhne z chyby surovou odpověď modelu, pokud ji nese (model odpověděl, jen ne ve tvaru). */
export function rawTextOf(error: unknown): string | null {
  if (!NoObjectGeneratedError.isInstance(error)) return null
  const text = (error as { text?: unknown }).text
  return typeof text === 'string' ? text : null
}

export interface LadderRun {
  /** Modely, které v běhu opravdu odpověděly (`poskytovatel:model`), v pořadí použití. */
  used: string[]
  /** Zavolá `fn` s prvním modelem, kterému ještě nedošel limit. */
  call<T>(fn: (config: AiConfig) => Promise<T>, options?: { nextOnBadShape?: boolean }): Promise<{ value: T; model: string }>
}

/**
 * Jeden běh nad žebříčkem modelů. Model, kterému došel limit nebo je
 * přetížený, se do konce běhu přeskakuje — jinak by na tutéž chybu čekala
 * každá další dávka. Chyba, na které nic nezmění ani jiný model (chybný klíč),
 * letí rovnou nahoru. Odpověď ve špatném tvaru znamená, že model funguje:
 * volající ji zachrání sám (otázky), nebo si řekne o další model (hlavolamy).
 */
export function startLadder(models: AiConfig[], signal?: AbortSignal): LadderRun {
  const exhausted = new Set<string>()
  const used: string[] = []
  const markUsed = (key: string) => {
    if (!used.includes(key)) used.push(key)
  }

  return {
    used,
    async call(fn, options = {}) {
      let lastError: unknown = new Error(NO_MODEL_MESSAGE)
      for (const config of models) {
        const key = describeAiConfig(config)
        if (exhausted.has(key)) continue
        try {
          const value = await fn(config)
          markUsed(key)
          return { value, model: key }
        } catch (error) {
          if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw error
          if (rawTextOf(error) !== null && !options.nextOnBadShape) {
            markUsed(key)
            throw error
          }
          if (!describeAiError(error).retryable) throw error
          exhausted.add(key)
          lastError = error
        }
      }
      throw lastError
    },
  }
}

/** Volání modelu, které vrací objekt podle schématu. Model se sestaví jednou na běh. */
export type ObjectCall<T> = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
}) => Promise<T>

export function objectCall<S extends z.ZodType>(schema: S): ObjectCall<z.infer<S>> {
  const models = new Map<string, LanguageModel>()
  return async ({ config, system, prompt, signal }) => {
    const key = describeAiConfig(config)
    let model = models.get(key)
    if (!model) {
      model = await getModel(config)
      models.set(key, model)
    }
    const { object } = await generateObject({
      model,
      schema,
      system,
      prompt,
      abortSignal: signal,
      maxRetries: AI_SETTINGS.maxRetries,
    })
    return object as z.infer<S>
  }
}
```

Kdyby TypeScript u `schema` v `generateObject` protestoval kvůli generickému `S`, přetypovat `schema: schema as z.ZodType<z.infer<S>>`.

- [ ] **Krok 5: Přepsat `generateQuestions`**

V `packages/core/src/ai/generate.ts`:
- Smazat konstanty `MAX_CHARS_PER_CALL`, `MAX_PER_CALL`, `MAX_AI_POINTS` a funkci `rawTextOf`; místo nich `import { AI_SETTINGS } from './settings'` a `import { objectCall, rawTextOf, startLadder } from './ladder'`.
- `chunkText(text, maxChars = AI_SETTINGS.maxCharsPerCall)`, `splitIntoBatches(count, perCall = AI_SETTINGS.questionsPerCall)`.
- Import z `./provider` zúžit na `readAiLadder, type AiConfig`; import z `'ai'` smazat, pokud už není potřeba.
- `withDefaultPoints` exportovat a použít `AI_SETTINGS.maxAiPoints`:

```ts
export function withDefaultPoints(question: QuestionContent): QuestionContent {
  if (question.points > 1 && question.points <= AI_SETTINGS.maxAiPoints) return question
  return { ...question, points: DEFAULT_POINTS[question.type] }
}
```

- Celou funkci `generateQuestions` nahradit:

```ts
/**
 * Vygeneruje otázky k materiálu.
 *
 * Nevalidní otázky zahodí a vrátí v `rejected`. Když schéma odmítne celou
 * odpověď, zachrání z ní otázky, které v pořádku jsou. Modelů může být víc
 * (žebříček `AI_MODELS`); přepíná se po dávce, takže hotové dávky zůstávají
 * uložené (`onBatch`), i když prvnímu modelu uprostřed dojde limit.
 */
export async function generateQuestions(
  request: GenerationRequest,
  options: {
    /** Žebříček modelů; bez něj se čte z prostředí (`AI_MODELS`). */
    models?: AiConfig[]
    signal?: AbortSignal
    onChunk?: (done: number, total: number) => void
    /** Po každé dávce, ať se dá ukládat průběžně; dostane i model, který dávku vyrobil. */
    onBatch?: (questions: QuestionContent[], info: { model: string }) => Promise<void> | void
    /** Podvržené volání modelu pro testy; v aplikaci se nepředává. */
    callModel?: ModelCall
  } = {},
): Promise<GenerationResult> {
  const ladder = startLadder(options.models ?? readAiLadder(), options.signal)
  const callModel: ModelCall =
    options.callModel ??
    (() => {
      const call = objectCall(responseSchema)
      return async (input) => ({ questions: (await call(input)).questions })
    })()
  const system = buildSystemPrompt(request.gradeName)

  const chunks = chunkText(request.text)
  const perChunk = Math.max(1, Math.ceil(request.count / chunks.length))
  // Rozvrh typů pro celé generování — každá dávka si vezme svůj úsek.
  const typeSchedule = distributeTypes(request.types, request.count)

  const accepted: QuestionContent[] = []
  const rejected: GenerationResult['rejected'] = []
  const failedCalls: GenerationResult['failedCalls'] = []

  for (const [index, chunk] of chunks.entries()) {
    const remaining = request.count - accepted.length
    if (remaining <= 0) break

    for (const batchSize of splitIntoBatches(Math.min(perChunk, remaining))) {
      if (accepted.length >= request.count) break

      const batchTypes = typeSchedule.slice(accepted.length, accepted.length + batchSize)
      const prompt = buildUserPrompt({
        ...request,
        text: chunk,
        count: batchSize,
        types: batchTypes.length > 0 ? batchTypes : request.types,
        // Nově vzniklé otázky jdou první, ať se ořezem seznamu neztratí.
        avoid: [...accepted.map(promptOf), ...(request.avoid ?? [])],
      })

      let produced: QuestionContent[] = []
      let batchModel = ''
      try {
        const result = await ladder.call((config) => callModel({ config, system, prompt, signal: options.signal }))
        produced = result.value.questions
        batchModel = result.model
      } catch (error) {
        const raw = rawTextOf(error)
        if (raw === null) throw error
        batchModel = ladder.used.at(-1) ?? ''
        try {
          produced = salvageQuestions(JSON.parse(raw))
        } catch {
          produced = []
        }
        if (produced.length === 0) {
          failedCalls.push({ reason: error instanceof Error ? error.message : String(error) })
          continue
        }
      }

      const batch: QuestionContent[] = []
      for (const [i, question] of produced.entries()) {
        const errors = validateQuestionContent(question)
        if (errors.length > 0) {
          rejected.push({ index: accepted.length + i, errors })
          continue
        }
        batch.push(withDefaultPoints(normalizeOrderingPayload(question)))
      }

      accepted.push(...batch)
      if (batch.length > 0) await options.onBatch?.(batch, { model: batchModel })
    }

    options.onChunk?.(index + 1, chunks.length)
  }

  return {
    questions: accepted.slice(0, request.count),
    rejected,
    chunks: chunks.length,
    failedCalls,
    models: ladder.used,
  }
}
```

- [ ] **Krok 6: Konstanty z `prompt.ts`**

V `packages/core/src/ai/prompt.ts` smazat `AVOID_LIMIT` a `AVOID_ITEM_MAX_LEN` (s jejich komentáři), importovat `AI_SETTINGS` z `'./settings'` a nahradit použití za `AI_SETTINGS.avoidLimit` a `AI_SETTINGS.avoidItemMaxLength`. Komentář od `AVOID_LIMIT` (proč 80, proč nové otázky první) přesunout k `avoidLimit` v `settings.ts`, pokud tam chybí něco podstatného.

V `packages/core/src/ai/index.ts` přidat:

```ts
export * from './settings'
export * from './ladder'
```

V `apps/web/src/lib/questions.ts` nahradit `import { AVOID_LIMIT } from '@testmaker/core/ai'` za `import { AI_SETTINGS } from '@testmaker/core/ai'`, `limit = AVOID_LIMIT` za `limit = AI_SETTINGS.avoidLimit` a v komentáři `AVOID_LIMIT` za `AI_SETTINGS.avoidLimit`.

- [ ] **Krok 7: Web bez workerů**

`apps/web/src/lib/generation.ts`:
- import: `import { generateQuestions } from '@testmaker/core/ai'` (bez `readOllamaWorkers` a `AiConfig`, pokud `AiConfig` jinde nepotřebuje),
- ve volbách `generateForTopic` smazat `/** Konkrétní Ollama worker pro tento běh. */ worker?: AiConfig`,
- ve volání `generate(…)` smazat řádky `worker: options.worker,` a `workers: options.worker ? undefined : readOllamaWorkers(),`,
- v náhradě otázky nahradit `{ signal: options.signal, workers: readOllamaWorkers() }` za `{ signal: options.signal }`.

`apps/web/scripts/generate-bulk.ts`:
- z importu `@testmaker/core/ai` vyhodit `readOllamaWorkers`,
- blok od `const workers = readOllamaWorkers()` po konec `console.log(…)` s popisem modelů nahradit:

```ts
  const ladder = readAiLadder()
  console.log(
    ladder.length > 1
      ? `žebříček modelů: ${ladder.map(describeAiConfig).join(' → ')}`
      : `model ${ladder[0] ? describeAiConfig(ladder[0]) : '—'}`,
  )
```

- `runTopic(topic, index, worker?)` → `runTopic(topic, index)`, volání `generateForTopic(…, worker ? { worker } : undefined)` → `generateForTopic(…)` bez čtvrtého argumentu,
- `workerLoop` a `Promise.all(…)` nahradit prostou smyčkou (témata jdou po sobě; cloudový model s limitem souběh nepotřebuje):

```ts
  for (const [index, topic] of rows.entries()) {
    try {
      await runTopic(topic, index)
    } catch (error) {
      failed += 1
      const { describeAiError } = await import('@testmaker/core/ai')
      console.log(`${index + 1}/${rows.length} ${topic.name}: ${describeAiError(error).message}`)
    }
  }
```

- smazat nepoužité `nextTopic` a `concurrency`; v hlavičkovém komentáři smazat větu o Ollama workerech.

- [ ] **Krok 8: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS. Testy ve webu, které podstrkují `generate`, se změnou voleb neovlivní (volby ignorují). Když typecheck najde další použití `workers`/`worker`/`configs` (např. v `apps/web/test`), upravit je stejně jako v kroku 1.

- [ ] **Krok 9: Commit**

```bash
git add packages/core/src/ai/settings.ts packages/core/src/ai/ladder.ts packages/core/src/ai/generate.ts \
  packages/core/src/ai/prompt.ts packages/core/src/ai/index.ts packages/core/test/ai-ladder.test.ts \
  apps/web/src/lib/generation.ts apps/web/src/lib/questions.ts apps/web/scripts/generate-bulk.ts
git commit -m "refactor(ai): one model ladder and one generation path

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 2: Tři poskytovatelé, jedna proměnná, uklizené .env

**Soubory:**
- Přepsat: `packages/core/src/ai/provider.ts`
- Upravit: `packages/core/src/ai/settings.ts` (nic nového, jen použití), `packages/core/src/ai/errors.ts`, `packages/core/package.json` (vyhodit `ollama-ai-provider-v2`)
- Upravit: `apps/web/src/lib/ai.ts`, `apps/web/src/lib/puzzles.ts`, `package.json` (kořen, smazat `dev:ant`)
- Upravit: `apps/web/.env.example`, `apps/web/.env.local` (není v gitu), `CLAUDE.md`
- Smazat: `packages/core/test/ai-compatible.test.ts`
- Test: `packages/core/test/ai.test.ts`, `packages/core/test/ai-ladder.test.ts`, `apps/web/test/generate-api.test.ts`

**Rozhraní:**
- Produkuje: `AiProviderName = 'google' | 'anthropic' | 'openrouter'`, `AiConfig = { provider; model }`, `AI_PROVIDERS: Record<AiProviderName, { label: string; keyEnv: string }>`, `parseModel(item): AiConfig | null`, `readAiLadder(env?): AiConfig[]`, `isAiConfigured(env?): boolean`, `getModel(config, { env?, fetch? })`, `describeAiConfig(config): string`.
- Zanikají: `readAiConfig`, `readOllamaWorkers`, `readOpenAiCompatibleSettings`, `OPENAI_COMPATIBLE_SERVICES`, `isOpenAiCompatible`, `AI_PROVIDER`, `AI_MODEL`, `OLLAMA_*`, `*_BASE_URL`, `CUSTOM_*`, `ANTHROPIC_AUTH_TOKEN`.

- [ ] **Krok 1: Napsat testy**

Smazat `packages/core/test/ai-compatible.test.ts`. V `packages/core/test/ai.test.ts` smazat celý blok `describe('konfigurace providera', …)` a import `readAiConfig`. V `packages/core/test/ai-ladder.test.ts` smazat blok `describe('žebříček modelů z prostředí', …)` a všechny testy `readOllamaWorkers`; import z provideru zúžit na `describeAiConfig, getModel, isAiConfigured, readAiLadder`. Na konec `ai-ladder.test.ts` přidat:

```ts
describe('žebříček modelů z prostředí', () => {
  it('bez AI_MODELS použije výchozí Gemini, když je klíč', () => {
    expect(readAiLadder({ GOOGLE_GENERATIVE_AI_API_KEY: 'g' })).toEqual([
      { provider: 'google', model: 'gemini-flash-latest' },
    ])
  })

  it('bez jediného klíče je generování vypnuté a nic nespadne', () => {
    expect(readAiLadder({})).toEqual([])
    expect(isAiConfigured({})).toBe(false)
  })

  it('drží pořadí z AI_MODELS a přeskočí poskytovatele bez klíče', () => {
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

  it('dvojtečku v názvu modelu nerozdělí', () => {
    expect(readAiLadder({ AI_MODELS: 'openrouter:vendor/model:free', OPENROUTER_API_KEY: 'o' })).toEqual([
      { provider: 'openrouter', model: 'vendor/model:free' },
    ])
  })

  it('neznámého poskytovatele a položku bez předpony vynechá, zbytek funguje', () => {
    const env = {
      AI_MODELS: 'ollama:qwen3:14b, gemini-flash-latest, google:gemini-flash-lite-latest',
      GOOGLE_GENERATIVE_AI_API_KEY: 'g',
    }
    expect(readAiLadder(env)).toEqual([{ provider: 'google', model: 'gemini-flash-lite-latest' }])
  })

  it('stejný model zařadí jen jednou', () => {
    const env = { AI_MODELS: 'google:a, google:a', GOOGLE_GENERATIVE_AI_API_KEY: 'g' }
    expect(readAiLadder(env)).toHaveLength(1)
  })
})

describe('sestavení modelu', () => {
  it('OpenRouter míří na openrouter.ai s klíčem z prostředí', async () => {
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
```

a do importů `import { generateText } from 'ai'`.

V `apps/web/test/generate-api.test.ts` nahradit `vi.stubEnv('AI_PROVIDER', '')` za `vi.stubEnv('AI_MODELS', '')` a přidat `vi.stubEnv('OPENROUTER_API_KEY', '')`; ostatní `stubEnv` klíčů nechat.

- [ ] **Krok 2: Ověřit, že testy padají**

Spustit: `cd packages/core && pnpm exec vitest run test/ai-ladder.test.ts -t "z prostředí|sestavení"`
Očekávat: FAIL — bez `AI_MODELS` a klíče se vrací výchozí Anthropic, `ollama:` se bere.

- [ ] **Krok 3: Nový `provider.ts`**

Celý soubor nahradit:

```ts
import type { LanguageModel } from 'ai'
import { AI_SETTINGS } from './settings'

/**
 * Poskytovatelé, se kterými aplikace mluví. Každý potřebuje jen svůj klíč;
 * který model a v jakém pořadí, říká jediná proměnná `AI_MODELS`.
 *
 * Anthropic jen s API klíčem z Console: přihlášení předplatným (Claude Max)
 * Anthropic mimo Claude Code odmítá. Otázky přes předplatné se dělají
 * v Claude Code příkazem `/otazky` a nahrávají se do tématu jako soubor.
 */
export type AiProviderName = 'google' | 'anthropic' | 'openrouter'

export interface AiConfig {
  provider: AiProviderName
  model: string
}

export const AI_PROVIDERS: Record<AiProviderName, { label: string; keyEnv: string }> = {
  google: { label: 'Google Gemini', keyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  anthropic: { label: 'Anthropic', keyEnv: 'ANTHROPIC_API_KEY' },
  openrouter: { label: 'OpenRouter', keyEnv: 'OPENROUTER_API_KEY' },
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

type Env = Record<string, string | undefined>

function isProviderName(value: string): value is AiProviderName {
  return Object.hasOwn(AI_PROVIDERS, value)
}

/**
 * Položka žebříčku `poskytovatel:model`. Dělí se jen na první dvojtečce —
 * modely zdarma u OpenRouteru končí na `:free`. Bez známé předpony `null`.
 */
export function parseModel(item: string): AiConfig | null {
  const trimmed = item.trim()
  const separator = trimmed.indexOf(':')
  if (separator <= 0) return null
  const provider = trimmed.slice(0, separator).trim()
  const model = trimmed.slice(separator + 1).trim()
  return isProviderName(provider) && model ? { provider, model } : null
}

function apiKeyOf(provider: AiProviderName, env: Env): string | undefined {
  return env[AI_PROVIDERS[provider].keyEnv]?.trim() || undefined
}

/**
 * Žebříček modelů: `AI_MODELS`, bez něj `AI_SETTINGS.defaultModels`. Když
 * modelu dojde limit, pokračuje se dalším (viz `startLadder`). Položky bez
 * klíče nebo s překlepem se vynechávají; placený model se tak nikdy nezapne
 * sám — jen tím, že ho majitel do žebříčku napíše a dá k němu klíč.
 */
export function readAiLadder(env: Env = process.env): AiConfig[] {
  const raw = env.AI_MODELS?.trim()
  const items = raw ? raw.split(',') : [...AI_SETTINGS.defaultModels]
  const ladder: AiConfig[] = []
  for (const item of items) {
    const config = parseModel(item)
    if (!config || !apiKeyOf(config.provider, env)) continue
    if (ladder.some((other) => other.provider === config.provider && other.model === config.model)) continue
    ladder.push(config)
  }
  return ladder
}

/** Je generování k dispozici? Bez něj ho rozhraní skryje a vysvětlí proč. */
export function isAiConfigured(env: Env = process.env): boolean {
  return readAiLadder(env).length > 0
}

export interface ModelOptions {
  /** Prostředí, ze kterého se berou klíče; v testech podvržené. */
  env?: Env
  /** Podvržený `fetch` pro testy — žádný test nesmí volat skutečnou službu. */
  fetch?: typeof globalThis.fetch
}

export async function getModel(config: AiConfig, options: ModelOptions = {}): Promise<LanguageModel> {
  const env = options.env ?? process.env
  const apiKey = apiKeyOf(config.provider, env)
  const fetch = options.fetch ? { fetch: options.fetch } : {}
  switch (config.provider) {
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({ apiKey, ...fetch })(config.model)
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey, ...fetch })(config.model)
    }
    case 'openrouter': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
        supportsStructuredOutputs: true,
        ...fetch,
      })(config.model)
    }
  }
}

/** Popis modelu do logu a hlášky: `google:gemini-flash-latest`. */
export function describeAiConfig(config: AiConfig): string {
  return `${config.provider}:${config.model}`
}
```

V `packages/core/package.json` smazat řádek `"ollama-ai-provider-v2": "^4.0.1",` a spustit `pnpm install`.

- [ ] **Krok 4: Hlášky v `errors.ts`**

V `packages/core/src/ai/errors.ts` nahradit tři hlášky:

```ts
      message:
        'Vyčerpaný limit modelu. U bezplatného tarifu Gemini se počítá na den — zkus to znovu zítra, ' +
        'nebo dopiš do .env.local (AI_MODELS) další model, třeba placený přes OpenRouter.',
```

```ts
      message: 'Model je právě přetížený. Za chvíli to zkus znovu, nebo dopiš do AI_MODELS další model.',
```

```ts
      message: 'Zvolený model už poskytovatel nenabízí. Oprav jeho název v AI_MODELS v .env.local.',
```

- [ ] **Krok 5: Web a kořen**

`apps/web/src/lib/ai.ts` celé:

```ts
import 'server-only'
import { AI_PROVIDERS, readAiLadder } from '@testmaker/core/ai'

/** Stav AI pro UI — bez modelu se generování schová místo pádu za běhu. Ukazuje první model žebříčku. */
export function aiStatus(): { configured: boolean; provider: string; model: string } {
  const first = readAiLadder()[0]
  return {
    configured: Boolean(first),
    provider: first ? AI_PROVIDERS[first.provider].label : '',
    model: first?.model ?? '',
  }
}
```

`apps/web/src/lib/puzzles.ts`: import `import { generatePuzzleWords } from '@testmaker/core/ai'`, volání `{ signal: options.signal, workers: readOllamaWorkers() }` → `{ signal: options.signal }`.

Kořenový `package.json`: smazat řádek `"dev:ant": …`.

`grep -rn "readAiConfig\|readOllamaWorkers\|OPENAI_COMPATIBLE\|AI_PROVIDER\|OLLAMA_\|ANTHROPIC_AUTH_TOKEN\|dev:ant" apps packages package.json CLAUDE.md --include='*' | grep -v node_modules` — nesmí vrátit nic kromě `.env*` souborů, které řeší další krok. Pozn.: `generatePuzzleWords` si žebříček čte sám přes `readAiLadder` — funguje dál i bez úkolu 3.

- [ ] **Krok 6: `.env.example`**

V `apps/web/.env.example` nahradit celý úsek od řádku `# AI pro generování otázek. Bez klíče (ani tokenu)…` až po řádek před `# Tajemství pro plánovač generování` tímto:

```
# AI pro generování otázek
# ------------------------
# Žebříček modelů v pořadí, v jakém se zkoušejí: `poskytovatel:model`, čárkou.
# Když modelu dojde limit, pokračuje se dalším — placený model patří na konec.
# Poskytovatelé: google, openrouter, anthropic. Bez AI_MODELS se použije
# google:gemini-flash-latest. Položky, ke kterým tu chybí klíč, se přeskakují;
# bez jediného použitelného modelu se generování v rozhraní skryje.
# AI_MODELS=google:gemini-flash-latest,openrouter:<model z openrouter.ai/models>
#
# Google AI Studio → API keys. Od září 2026 platí jen klíče typu „Auth".
GOOGLE_GENERATIVE_AI_API_KEY=
# OpenRouter (platí se po tokenech) → openrouter.ai/keys
# OPENROUTER_API_KEY=
# Anthropic Console (API klíč; předplatné Claude Max tu nefunguje — na otázky
# přes předplatné je v Claude Code příkaz /otazky)
# ANTHROPIC_API_KEY=
#
# Nastavení generování (velikost úseků, počty) je v packages/core/src/ai/settings.ts.

```

- [ ] **Krok 7: `.env.local` (bez vypisování hodnot)**

`apps/web/.env.local` není v gitu a obsahuje klíče. Nevypisovat ho. Upravit nástrojem Edit (po Read), nebo skriptem, který hodnoty nečte na výstup:
- smazat řádky `AI_PROVIDER=…`, `AI_MODEL=…`, `OLLAMA_WORKERS=…`, `OLLAMA_CONCURRENCY=…`, `OLLAMA_BASE_URL=…` (i zakomentované) a zakomentované řádky o AI (`# AI pro generování…`, `# Lokální model (fáze 2)`, `# OPENROUTER_API_KEY=`, `# AI_MODELS=`),
- ponechat `DATABASE_URL`, `DATABASE_AUTH_TOKEN` (zakomentovaný), `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` s jejich hodnotami,
- přidat nad klíče blok:

```
# AI: žebříček modelů (viz .env.example)
AI_MODELS=google:gemini-flash-latest
```

Kontrola: `sed -E 's/=.*/=…/' apps/web/.env.local` — ukáže jen názvy.

- [ ] **Krok 8: `CLAUDE.md`**

Do `CLAUDE.md` za pravidlo „Bez API klíče se nepadá." přidat:

```markdown
**Nastavení AI na jednom místě.** Model a pořadí modelů určuje jen `AI_MODELS`
v `.env.local` (`poskytovatel:model`, čárkou; poskytovatelé `google`,
`openrouter`, `anthropic`), klíče mají vlastní proměnné. Čísla generování
(velikost úseku, otázek na volání, limity) jsou v `packages/core/src/ai/settings.ts`,
texty pro model v `packages/core/src/ai/prompts/`, volání modelu se žebříčkem
v `packages/core/src/ai/ladder.ts`. Nová konstanta nebo prompt jinam nepatří.
Předplatné Claude Max se v aplikaci použít nedá; otázky přes něj vznikají
v Claude Code příkazem `/otazky` a nahrávají se do tématu jako soubor.
```

- [ ] **Krok 9: Ověřit**

Spustit: `pnpm install && pnpm test && pnpm typecheck && pnpm build`
Očekávat: PASS. Kdyby padal test v `packages/core/test/puzzle.test.ts` kvůli volbám `configs`/`config` v `generatePuzzleWords`, nechat ho — volby hlavolamů mění až úkol 3; tady se hlavolamy nemění.

- [ ] **Krok 10: Commit**

```bash
git rm packages/core/test/ai-compatible.test.ts
git add packages/core/src/ai/provider.ts packages/core/src/ai/errors.ts packages/core/package.json pnpm-lock.yaml \
  packages/core/test/ai.test.ts packages/core/test/ai-ladder.test.ts apps/web/test/generate-api.test.ts \
  apps/web/src/lib/ai.ts apps/web/src/lib/puzzles.ts package.json apps/web/.env.example CLAUDE.md
git commit -m "refactor(ai): configure models with AI_MODELS only, drop Ollama and unused services

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Pozn. pro majitele (do závěrečné zprávy): generování teď jede přes Gemini — klíč `GOOGLE_GENERATIVE_AI_API_KEY` musí být typu „Auth" (AI Studio → API keys → sloupec Key Type).

---

### Úkol 3: Hlavolamy na společném žebříčku (čeká na majitele)

**Předpoklad:** majitel commitnul své rozpracované změny v `puzzleWords.ts`, `PuzzleBody.tsx` a `PaperPuzzle.tsx`. Ověřit `git status --short packages/core/src/ai/puzzleWords.ts` — musí být prázdné. Jinak úkol přeskočit, pokračovat úkolem 4 a na konci ho majiteli připomenout.

**Soubory:**
- Vytvořit: `packages/core/src/ai/prompts/puzzleWords.ts`
- Upravit: `packages/core/src/ai/puzzleWords.ts`, `packages/core/src/ai/index.ts`
- Test: `packages/core/test/puzzle.test.ts`

**Rozhraní:**
- `generatePuzzleWords(request, options?: { models?: AiConfig[]; signal?: AbortSignal; callModel?: PuzzleWordsCall })`.
- `buildPuzzleWordsSystemPrompt()` a `buildPuzzleWordsPrompt(request)` se stěhují beze změny obsahu do `prompts/puzzleWords.ts`.

- [ ] **Krok 1: Testy na novou volbu**

V `packages/core/test/puzzle.test.ts` nahradit u `generatePuzzleWords` volby `configs: [...]` za `models: [...]`, `config: X` za `models: [X]` a smazat testy s `workers`. Přidat:

```ts
it('odpověď ve špatném tvaru zkusí dalším modelem', async () => {
  const volani: string[] = []
  const call: PuzzleWordsCall = async ({ config }) => {
    volani.push(config.model)
    if (config.model === 'a') throw new NoObjectGeneratedError({ message: 'x', text: '{}', response: {} as never, usage: {} as never, finishReason: 'stop' })
    return { words: [{ word: 'houba', clue: 'Roste v lese a má klobouk.' }] }
  }
  const vysledek = await generatePuzzleWords(
    { text: 'Houba roste v lese.', topicName: 'Houby', count: 1 } as never,
    { models: [{ provider: 'google', model: 'a' }, { provider: 'google', model: 'b' }], callModel: call },
  )
  expect(volani).toEqual(['a', 'b'])
  expect(vysledek.entries.map((e) => e.word)).toEqual(['houba'])
})
```

(`NoObjectGeneratedError` z `'ai'` — argumenty konstruktoru ověřit v `node_modules/ai/dist/index.d.ts` a doplnit povinná pole; podstatné je jen `text`. Tvar `request` převzít z existujících testů v souboru místo `as never`.)

- [ ] **Krok 2: Ověřit, že padá**

Spustit: `cd packages/core && pnpm exec vitest run test/puzzle.test.ts`
Očekávat: FAIL — volba `models` neexistuje.

- [ ] **Krok 3: Implementace**

Přesunout `buildPuzzleWordsSystemPrompt`, `buildPuzzleWordsPrompt` a konstanty, které používají jen ony (`MAX_CHARS` apod.), do `packages/core/src/ai/prompts/puzzleWords.ts` beze změny textu; v `puzzleWords.ts` je importovat. Konstanty sdílené s `filterEntries` (`MIN_LETTERS`, `MAX_LETTERS`) nechat v `puzzleWords.ts` a do promptů je importovat odtud.

V `generatePuzzleWords` nahradit volby a tělo od `const ladder =` po konec funkce:

```ts
  options: {
    /** Žebříček modelů; bez něj se čte z prostředí (`AI_MODELS`). */
    models?: AiConfig[]
    signal?: AbortSignal
    /** Podvržené volání modelu pro testy; v aplikaci se nepředává. */
    callModel?: PuzzleWordsCall
  } = {},
): Promise<PuzzleWordsResult> {
  const ladder = startLadder(options.models ?? readAiLadder(), options.signal)
  const callModel: PuzzleWordsCall =
    options.callModel ??
    (() => {
      const call = objectCall(responseSchema)
      return async (input) => ({ words: (await call(input)).words })
    })()
  const system = buildPuzzleWordsSystemPrompt()
  const prompt = buildPuzzleWordsPrompt(request)
  // Slova nejde zachránit po kouscích jako otázky — špatný tvar znamená zkusit další model.
  const { value, model } = await ladder.call(
    (config) => callModel({ config, system, prompt, signal: options.signal }),
    { nextOnBadShape: true },
  )
  return { ...filterEntries(value.words), models: [model] }
}
```

Importy: `import { objectCall, startLadder } from './ladder'`, `import { readAiLadder, type AiConfig } from './provider'`; smazat nepoužité `generateObject`, `LanguageModel`, `getModel`, `describeAiConfig`, `describeAiError`. Do `index.ts` přidat `export * from './prompts/puzzleWords'`.

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ai/puzzleWords.ts packages/core/src/ai/prompts/puzzleWords.ts packages/core/src/ai/index.ts packages/core/test/puzzle.test.ts
git commit -m "refactor(ai): puzzle words share the model ladder and prompt folder

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 4: Prompty otázek do `prompts/`

**Soubory:**
- Přesunout: `packages/core/src/ai/prompt.ts` → `packages/core/src/ai/prompts/questions.ts`
- Upravit: `packages/core/src/ai/index.ts`, `packages/core/src/ai/generate.ts`, testy importující `../src/ai/prompt`

**Rozhraní:**
- Exportuje navíc `QUESTION_TYPE_HINTS` (dnešní `TYPE_HINTS`, přejmenované a exportované) — použije ho úkol 10.

- [ ] **Krok 1: Přesun**

```bash
mkdir -p packages/core/src/ai/prompts
git mv packages/core/src/ai/prompt.ts packages/core/src/ai/prompts/questions.ts
```

V `prompts/questions.ts` opravit relativní importy (`'../schema/question'` → `'../../schema/question'`, `'./settings'` → `'../settings'`), `const TYPE_HINTS` → `export const QUESTION_TYPE_HINTS` (a jeho použití). V `index.ts` nahradit `export * from './prompt'` za `export * from './prompts/questions'`. V `generate.ts` import `'./prompt'` → `'./prompts/questions'`. Ve všech testech: `grep -rln "src/ai/prompt'" packages/core/test` a import přepsat na `'../src/ai/prompts/questions'`.

- [ ] **Krok 2: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS beze změny chování.

- [ ] **Krok 3: Commit**

```bash
git add -u packages/core/src/ai packages/core/test
git add packages/core/src/ai/prompts/questions.ts
git status --short   # zkontrolovat, že se nestageuje puzzleWords.ts majitele
git commit -m "refactor(ai): keep all model prompts in one folder

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Pozn.: `git add -u packages/core/src/ai` by stageoval i rozpracovaný `puzzleWords.ts`, pokud úkol 3 neproběhl. V tom případě ho před commitem vrátit ze stage: `git restore --staged packages/core/src/ai/puzzleWords.ts`.

---

### Úkol 5: AI v aplikaci generuje jen tři jednoduché typy

**Soubory:**
- Upravit: `packages/core/src/schema/question.ts` (definice `AI_QUESTION_TYPES`), `packages/core/src/ai/generate.ts`
- Test: `packages/core/test/ai-ladder.test.ts`

**Rozhraní:**
- `AI_QUESTION_TYPES = ['single_choice', 'true_false', 'short_answer'] as const`, typ `AiQuestionType`; `onlyAiTypes(types: QuestionType[]): QuestionType[]` v `generate.ts`.
- `AI_QUESTION_TYPES` zůstává ve schématu (ne v `ai/`), protože ho importují klientské komponenty a `@testmaker/core/ai` do prohlížeče nepatří.

- [ ] **Krok 1: Napsat padající test**

Na konec `ai-ladder.test.ts` (pokud TypeScript protestuje proti přepisu `types` v `ZADANI`, přetypovat `as QuestionType[]` a doplnit import typu):

```ts
describe('typy otázek pro AI', () => {
  it('úloha se starým typem z fronty generuje jen povolené typy', async () => {
    const prompty: string[] = []
    const call: ModelCall = async ({ prompt }) => {
      prompty.push(prompt)
      return { questions: [otazka(prompty.length)] }
    }
    await generateQuestions({ ...ZADANI, count: 2, types: ['matching', 'short_answer'] }, { models: [PRVNI], callModel: call })
    expect(prompty.join('\n')).not.toContain('matching')
    expect(prompty.join('\n')).toContain('short_answer')
  })

  it('bez jediného povoleného typu použije všechny povolené', async () => {
    const prompty: string[] = []
    const call: ModelCall = async ({ prompt }) => {
      prompty.push(prompt)
      return { questions: [otazka(prompty.length)] }
    }
    await generateQuestions({ ...ZADANI, count: 3, types: ['matching'] }, { models: [PRVNI], callModel: call })
    expect(prompty.join('\n')).not.toContain('matching')
    expect(prompty.join('\n')).toContain('single_choice')
  })
})
```

- [ ] **Krok 2: Ověřit, že padá**

Spustit: `cd packages/core && pnpm exec vitest run test/ai-ladder.test.ts -t "typy otázek pro AI"`
Očekávat: FAIL — prompt obsahuje `matching`.

- [ ] **Krok 3: Implementace**

V `packages/core/src/schema/question.ts` nahradit definici `AI_QUESTION_TYPES` (i s komentářem):

```ts
/**
 * Typy, které generuje AI v aplikaci. Jen jednoduché: u přiřazování, řazení,
 * tabulek a doplňování se menší modely pletou v indexech a počtech a vzniká
 * klíč, který nedává smysl. Ostatní typy zůstávají pro ruční tvorbu a pro
 * otázky z Claude Code (`/otazky`).
 */
export const AI_QUESTION_TYPES = ['single_choice', 'true_false', 'short_answer'] as const satisfies readonly QuestionType[]

export type AiQuestionType = (typeof AI_QUESTION_TYPES)[number]
```

V `generate.ts` rozšířit import ze schématu o `AI_QUESTION_TYPES`, nad `generateQuestions` přidat:

```ts
/**
 * Požadované typy zúžené na ty, které smí AI generovat. Ve frontě můžou čekat
 * úlohy založené dřív, s typy, které už model nedostává; ty se tiše vynechají.
 * Když nezbude nic, generuje se ze všech povolených.
 */
export function onlyAiTypes(types: QuestionType[]): QuestionType[] {
  const allowed = types.filter((t) => (AI_QUESTION_TYPES as readonly QuestionType[]).includes(t))
  return allowed.length > 0 ? allowed : [...AI_QUESTION_TYPES]
}
```

a jako první řádek těla `generateQuestions`:

```ts
  request = { ...request, types: onlyAiTypes(request.types) }
```

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS. Kdyby typecheck hlásil `apps/web/src/lib/generation.ts` u `AI_QUESTION_TYPES.includes(type as …)`, přepsat na `(AI_QUESTION_TYPES as readonly string[]).includes(type)` jako v `useRegenerateQuestion.ts`.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/schema/question.ts packages/core/src/ai/generate.ts packages/core/test/ai-ladder.test.ts
# + apps/web/src/lib/generation.ts, pokud se měnil
git commit -m "fix(ai): generate only the question types models get right

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 6: Malé úseky materiálu po celém tématu

**Soubory:**
- Upravit: `packages/core/src/ai/settings.ts` (`maxCharsPerCall: 8_000`), `packages/core/src/ai/generate.ts` (`chunkText`, nové `splitLong`, `pickChunks`)
- Test: `packages/core/test/ai.test.ts`

**Rozhraní:**
- `chunkText(text, maxChars?)` — stejná signatura, nové chování; `pickChunks(chunks: string[], count: number): string[]`.

- [ ] **Krok 1: Napsat padající testy**

Do importu v `ai.test.ts` přidat `pickChunks`. Do bloku `describe('dělení dlouhých materiálů', …)` přidat:

```ts
  it('výchozí úsek má nejvýš 8 000 znaků', () => {
    const text = `${'Věta o vodě. '.repeat(50)}\n\n`.repeat(40)
    for (const chunk of chunkText(text)) expect(chunk.length).toBeLessThanOrEqual(8_000)
  })

  it('text bez prázdných řádků rozdělí po větách', () => {
    const text = 'Voda se vypařuje z hladiny moří. '.repeat(300)
    const chunks = chunkText(text, 1000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1000)
    expect(chunks.join(' ').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
  })

  it('záhlaví souboru přenese do každého dalšího úseku', () => {
    const odstavec = `${'b'.repeat(400)}\n\n`
    const text = `=== voda.pdf ===\n${odstavec.repeat(5)}=== vzduch.pdf ===\n${odstavec.repeat(5)}`
    const chunks = chunkText(text, 1000)
    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks) expect(chunk).toMatch(/^=== (voda|vzduch)\.pdf ===/)
    expect(chunks.at(-1)).toMatch(/^=== vzduch\.pdf ===/)
  })
```

a za tento blok nový:

```ts
describe('výběr úseků', () => {
  it('při dostatku otázek bere všechny úseky', () => {
    expect(pickChunks(['a', 'b', 'c'], 10)).toEqual(['a', 'b', 'c'])
  })

  it('při málo otázkách rozloží výběr po celém materiálu', () => {
    const chunks = Array.from({ length: 25 }, (_, i) => `u${i}`)
    const picked = pickChunks(chunks, 10)
    expect(picked).toHaveLength(10)
    expect(picked[0]).toBe('u0')
    expect(Number(picked.at(-1)!.slice(1))).toBeGreaterThanOrEqual(20)
    expect(new Set(picked).size).toBe(10)
  })
})
```

- [ ] **Krok 2: Ověřit, že padají**

Spustit: `cd packages/core && pnpm exec vitest run test/ai.test.ts -t "úsek|výběr úseků|záhlaví|prázdných"`
Očekávat: FAIL.

- [ ] **Krok 3: Implementace**

V `settings.ts` změnit `maxCharsPerCall: 120_000` na `maxCharsPerCall: 8_000` a komentář na:

```ts
  /**
   * Nejdelší úsek materiálu v jednom volání (znaky). S úsekem o pár stranách
   * model pracuje přesně; se stovkou stran se ztratí a začne vymýšlet.
   */
```

V `generate.ts` nahradit `chunkText` (ponechat výchozí `maxChars = AI_SETTINGS.maxCharsPerCall`):

```ts
const FILE_HEADER = /^=== .+ ===$/

function firstLine(text: string): string {
  return (text.split('\n', 1)[0] ?? '').trim()
}

/**
 * Rozdělí příliš dlouhý kus textu na části do `maxChars`: po řádcích,
 * a když je i řádek moc dlouhý (text z PDF bývá jeden nekonečný řádek), po
 * větách. Věta delší než limit zůstane celá.
 */
function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const pieces = text.includes('\n') ? text.split('\n') : text.split(/(?<=[.!?])\s+/)
  if (pieces.length === 1) return pieces
  const parts: string[] = []
  let current = ''
  for (const piece of pieces.flatMap((p) => splitLong(p, maxChars))) {
    if (current && current.length + piece.length + 1 > maxChars) {
      parts.push(current)
      current = ''
    }
    current = current ? `${current} ${piece}` : piece
  }
  if (current) parts.push(current)
  return parts
}

/**
 * Rozdělí dlouhý text na části na hranicích odstavců. Záhlaví `=== soubor ===`
 * se přenáší do každé další části téhož souboru — model podle něj vyplňuje
 * `evidence.fileName`.
 */
export function chunkText(text: string, maxChars: number = AI_SETTINGS.maxCharsPerCall): string[] {
  if (text.length <= maxChars) return [text]
  const parts: string[] = []
  let current = ''
  let header: string | null = null

  for (const paragraph of text.split(/\n\n+/)) {
    if (FILE_HEADER.test(firstLine(paragraph))) header = firstLine(paragraph)

    for (const piece of splitLong(paragraph, maxChars)) {
      const onlyHeader = current.trim() === '' || current.trim() === header
      if (!onlyHeader && current.length + piece.length + 2 > maxChars) {
        parts.push(current.trim())
        current = header && !FILE_HEADER.test(firstLine(piece)) ? `${header}\n` : ''
      }
      current += `${piece}\n\n`
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/**
 * Když je úseků víc než otázek, vybere je rovnoměrně po celém materiálu —
 * jinak by u dlouhého tématu a pár otázek padly všechny na první kapitoly.
 */
export function pickChunks(chunks: string[], count: number): string[] {
  if (chunks.length <= count) return chunks
  return Array.from({ length: count }, (_, i) => chunks[Math.floor((i * chunks.length) / count)] as string)
}
```

V `generateQuestions` řádek `const chunks = chunkText(request.text)` nahradit:

```ts
  const chunks = pickChunks(chunkText(request.text), request.count)
```

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS včetně původního testu „dělí na hranicích odstavců". Úsek smí obsahovat konec jednoho souboru a začátek dalšího; test hlídá, že každý úsek začíná záhlavím.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ai/settings.ts packages/core/src/ai/generate.ts packages/core/test/ai.test.ts
git commit -m "fix(ai): feed the model a few pages at a time from the whole topic

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 7: Otázka s vymyšlenou citací se zahodí

**Soubory:**
- Upravit: `packages/core/src/ai/settings.ts` (`minEvidencePart: 8`), `packages/core/src/ai/generate.ts`
- Test: `packages/core/test/ai.test.ts`, `packages/core/test/ai-ladder.test.ts`

**Rozhraní:**
- `EVIDENCE_NOT_FOUND = 'citace v evidence se v materiálu nenašla'`, `evidenceMatches(question: QuestionContent, source: string): boolean`, `checkQuestion(question: QuestionContent, source: string): string[]` — použije je i úkol 10.
- Pravidlo: otázka **bez** citace projde; otázka **s** citací, která v textu není, se zahodí.

- [ ] **Krok 1: Napsat padající testy**

Do importu v `ai.test.ts` přidat `evidenceMatches`. Na konec souboru:

```ts
describe('kontrola citace', () => {
  const usek = '=== voda.pdf ===\nVoda se v přírodě neustále pohybuje.\nTento děj nazýváme „koloběh vody".'
  const s = (quote?: string): QuestionContent =>
    questionContentSchema.parse({
      type: 'short_answer',
      payload: { prompt: 'Jak nazýváme pohyb vody v přírodě?', answer: 'koloběh vody' },
      ...(quote === undefined ? {} : { evidence: { fileName: 'voda.pdf', quote } }),
    })

  it('doslovná citace projde', () => {
    expect(evidenceMatches(s('Voda se v přírodě neustále pohybuje.'), usek)).toBe(true)
  })

  it('snese jiné uvozovky, velikost písmen, chybějící tečku a zalomení řádku', () => {
    expect(evidenceMatches(s('tento děj nazýváme "koloběh vody"'), usek)).toBe(true)
    expect(evidenceMatches(s('pohybuje. Tento děj'), usek)).toBe(true)
  })

  it('snese vypuštění uprostřed citace', () => {
    expect(evidenceMatches(s('Voda se v přírodě … neustále pohybuje'), usek)).toBe(true)
  })

  it('vymyšlenou citaci odmítne', () => {
    expect(evidenceMatches(s('Voda se vypařuje při teplotě 100 stupňů.'), usek)).toBe(false)
  })

  it('otázka bez citace projde', () => {
    expect(evidenceMatches(s(), usek)).toBe(true)
    expect(evidenceMatches(s('   '), usek)).toBe(true)
  })
})
```

Na konec `ai-ladder.test.ts`:

```ts
describe('kontrola citace při generování', () => {
  it('otázku s citací, která v materiálu není, zahodí a ostatní ponechá', async () => {
    const call: ModelCall = async () => ({
      questions: [
        { ...otazka(1), evidence: { fileName: 'x', quote: 'Koloběh vody v přírodě zahrnuje výpar' } },
        { ...otazka(2), evidence: { fileName: 'x', quote: 'Voda vře při sto stupních.' } },
      ],
    })
    const vysledek = await generateQuestions({ ...ZADANI, count: 2 }, { models: [PRVNI], callModel: call })
    expect(vysledek.questions.map((q) => (q.payload as { prompt: string }).prompt)).toEqual(['Otázka číslo 1?'])
    expect(vysledek.rejected[0]?.errors).toContain('citace v evidence se v materiálu nenašla')
  })
})
```

- [ ] **Krok 2: Ověřit, že padají**

Spustit: `cd packages/core && pnpm exec vitest run test/ai.test.ts test/ai-ladder.test.ts -t "citace"`
Očekávat: FAIL.

- [ ] **Krok 3: Implementace**

Do `AI_SETTINGS` přidat:

```ts
  /** Nejkratší kus citace, který má smysl v materiálu hledat; kratší by se našel kdekoli. */
  minEvidencePart: 8,
```

Do `generate.ts` nad `generateQuestions`:

```ts
export const EVIDENCE_NOT_FOUND = 'citace v evidence se v materiálu nenašla'

/**
 * Text pro porovnání citace s materiálem: bez rozdílu velikosti písmen,
 * uvozovek a bílých znaků. Model citaci opisuje a drobnosti mění; kvůli nim
 * se otázka zahodit nesmí.
 */
function normalizeForMatch(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[„“”"'‚‘’«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Stojí citace z `evidence` opravdu v materiálu? Citace se dělí na vypuštění
 * („…", „...") a každý kus musí v textu být. Otázka bez citace projde —
 * chybějící doklad je slabší prohřešek než vymyšlený.
 */
export function evidenceMatches(question: QuestionContent, source: string): boolean {
  const quote = question.evidence?.quote?.trim()
  if (!quote) return true
  const haystack = normalizeForMatch(source)
  const parts = quote
    .split(/…|\.\.\./)
    .map((part) => normalizeForMatch(part).replace(/[.,;:!?]+$/, '').trim())
    .filter((part) => part.length >= AI_SETTINGS.minEvidencePart)
  if (parts.length === 0) return true
  return parts.every((part) => haystack.includes(part))
}

/** Všechny důvody, proč otázku nepustit do banky: tvar i doklad. */
export function checkQuestion(question: QuestionContent, source: string): string[] {
  const errors = validateQuestionContent(question)
  if (!evidenceMatches(question, source)) errors.push(EVIDENCE_NOT_FOUND)
  return errors
}
```

V `generateQuestions` ve smyčce přes `produced` nahradit `const errors = validateQuestionContent(question)` za `const errors = checkQuestion(question, chunk)`.

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ai/settings.ts packages/core/src/ai/generate.ts packages/core/test/ai.test.ts packages/core/test/ai-ladder.test.ts
git commit -m "fix(ai): drop questions whose quoted evidence is not in the material

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 8: Kratší systémový prompt

**Soubory:**
- Upravit: `packages/core/src/ai/prompts/questions.ts`
- Test: `packages/core/test/ai.test.ts`

Existující testy hlídají, že prompt obsahuje: `výhradně z dodaného materiálu`, `Otázka musí být samostatná`, `podle materiálu`, `uvedeno výše`, `evidence`, `vysoké školy`, `odborností materiálu`, `základní škol`, u 8. ročníku `13–14 let`. Nový prompt je zachovává.

- [ ] **Krok 1: Napsat padající test**

Do bloku `describe('prompty', …)`:

```ts
  it('systémový prompt je krátký, aby ho model udržel celý', () => {
    const prompt = buildSystemPrompt('6. ročník')
    expect(prompt.length).toBeLessThan(1600)
    expect(prompt).toContain('doslova')
  })
```

- [ ] **Krok 2: Ověřit, že padá**

Spustit: `cd packages/core && pnpm exec vitest run test/ai.test.ts -t "krátký"`
Očekávat: FAIL.

- [ ] **Krok 3: Implementace**

Tělo `buildSystemPrompt` nahradit:

```ts
export function buildSystemPrompt(gradeName?: string | null): string {
  const audience = describeGradeAudience(gradeName)
  // Pravidel je schválně málo — co jde zkontrolovat v kódu (tvar, indexy,
  // citace), se kontroluje v kódu (`checkQuestion`), ne promptem.
  return [
    'Jsi učitel na české základní škole a píšeš otázky do písemky.',
    '',
    `Otázky řeší ${audience}. Náročnost se řídí ročníkem, ne odborností materiálu:`,
    'z odborného výkladu udělej otázku na jeho podstatu. Nikdy netvoř otázku na úrovni střední nebo vysoké školy.',
    '',
    'Pravidla:',
    '1. Vycházej výhradně z dodaného materiálu. Každá otázka má jednu správnou odpověď, která v materiálu opravdu stojí.',
    '2. Piš jednoduchou spisovnou češtinou. Zadání je jedna krátká věta.',
    '3. Ptej se na hlavní myšlenky, ne na okrajové podrobnosti.',
    '4. Otázka musí být samostatná: nepiš "podle materiálu", "jak je uvedeno výše" ani nic podobného.',
    '5. Možnosti výběru patří jen do pole `options`, nikdy do textu zadání. Špatné možnosti jsou věrohodné, ale jednoznačně špatné.',
    '6. Do `evidence` napiš název souboru ze záhlaví `=== … ===` a jednu větu z materiálu doslova, beze změny slov. Otázka s citací, která v materiálu není, se zahodí.',
    '7. Do `explanation` napiš jednu větu pro učitele, proč je odpověď správná.',
    '8. Otázky se nesmějí opakovat ani ptát na totéž jinými slovy.',
  ].join('\n')
}
```

V `QUESTION_TYPE_HINTS` nahradit tři položky (ostatní ponechat — používá je `/otazky`):

```ts
  short_answer: 'Odpověď je jedno slovo nebo krátké sousloví z materiálu. Do `acceptedAnswers` dej běžné varianty.',
  single_choice: 'Čtyři možnosti, právě jedna správná. `correctIndex` je pořadí správné možnosti od nuly.',
  true_false: '4 krátká tvrzení, zhruba půl pravdivých. Nepravdivé tvrzení vznikne malou změnou pravdivého.',
```

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ai/prompts/questions.ts packages/core/test/ai.test.ts
git commit -m "fix(ai): cut the system prompt to rules a model can hold

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 9: Duplicity i při jiné interpunkci

**Soubory:**
- Upravit: `packages/core/src/ai/generate.ts` (`dedupeKey`, deduplikace v `generateQuestions`)
- Test: `packages/core/test/ai-ladder.test.ts`

**Rozhraní:**
- `dedupeKey(text: string): string` — použije i úkol 10.

- [ ] **Krok 1: Napsat padající test**

```ts
describe('duplicity', () => {
  it('stejné zadání lišící se velikostí písmen a interpunkcí uloží jen jednou', async () => {
    const zneni = ['Co je výpar?', 'co je výpar', 'Co je  výpar ?']
    const call: ModelCall = async () => ({
      questions: zneni.map((prompt) => ({ ...otazka(0), payload: { prompt, answer: 'odpověď', acceptedAnswers: [] } })),
    })
    const vysledek = await generateQuestions({ ...ZADANI, count: 3 }, { models: [PRVNI], callModel: call })
    expect(vysledek.questions).toHaveLength(1)
  })

  it('otázku, která už v tématu je, znovu neuloží', async () => {
    const call: ModelCall = async () => ({
      questions: [{ ...otazka(0), payload: { prompt: 'Co je výpar?', answer: 'odpověď', acceptedAnswers: [] } }],
    })
    const vysledek = await generateQuestions(
      { ...ZADANI, count: 1, avoid: ['co je VÝPAR'] },
      { models: [PRVNI], callModel: call },
    )
    expect(vysledek.questions).toHaveLength(0)
  })
})
```

- [ ] **Krok 2: Ověřit, že padá**

Spustit: `cd packages/core && pnpm exec vitest run test/ai-ladder.test.ts -t "duplicity"`
Očekávat: FAIL — uloží se tři varianty; otázka z `avoid` projde.

- [ ] **Krok 3: Implementace**

Vedle `promptOf` v `generate.ts`:

```ts
/**
 * Klíč pro rozpoznání téže otázky: bez velikosti písmen, interpunkce
 * a rozdílů v mezerách. Model tutéž otázku často vrátí jen s jinou tečkou.
 */
export function dedupeKey(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
```

V `generateQuestions` před smyčku přes úseky:

```ts
  const seen = new Set((request.avoid ?? []).map(dedupeKey))
```

a ve smyčce přes `produced` nahradit `batch.push(withDefaultPoints(normalizeOrderingPayload(question)))`:

```ts
        const normalized = withDefaultPoints(normalizeOrderingPayload(question))
        const key = dedupeKey(promptOf(normalized))
        if (seen.has(key)) continue
        seen.add(key)
        batch.push(normalized)
```

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS. Kdyby padal starší test, kde podvržený model vrací v různých dávkách totéž zadání, upravit podvržený model, ať čísluje (jako `podvrzenyModel`) — deduplikaci nevracet.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ai/generate.ts packages/core/test/ai-ladder.test.ts
git commit -m "fix(ai): recognise the same question despite case and punctuation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 10: Soubor s otázkami z Claude Code — kontrola, skripty, skill `/otazky`

**Soubory:**
- Vytvořit: `packages/core/src/ai/questionFile.ts`
- Vytvořit: `apps/web/scripts/env.ts`, `apps/web/scripts/otazky-pravidla.ts`, `apps/web/scripts/otazky-over.ts`
- Vytvořit: `.claude/skills/otazky/SKILL.md`
- Upravit: `packages/core/src/ai/index.ts`, `apps/web/package.json`, `apps/web/scripts/generate-bulk.ts` (sdílené `loadEnv`)
- Test: `packages/core/test/question-file.test.ts`

**Rozhraní:**
- Konzumuje: `checkQuestion`, `dedupeKey`, `promptOf`, `withDefaultPoints` (`generate.ts`), `normalizeOrderingPayload`, `questionContentSchema` (schéma), `buildSystemPrompt`, `QUESTION_TYPE_HINTS` (`prompts/questions.ts`).
- Produkuje: `readQuestionFile(json: string, source: string, existing?: string[]): { questions: QuestionContent[]; rejected: { index: number; errors: string[] }[] }`, `CLAUDE_CODE_MODEL = 'claude-code'`, `existingPromptsFromSource(source: string): string[]`, `buildTopicSourceFile(meta: { subjectName: string; gradeName: string | null; topicName: string; text: string; existing: string[] }): string`, `buildQuestionRules(gradeName: string | null): string`.

- [ ] **Krok 1: Napsat padající testy**

`packages/core/test/question-file.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTopicSourceFile, existingPromptsFromSource, readQuestionFile } from '../src/ai/questionFile'

const ZDROJ = buildTopicSourceFile({
  subjectName: 'Přírodopis',
  gradeName: '6. ročník',
  topicName: 'Houby',
  text: '=== houby.pdf ===\nHouby nemají chlorofyl.\nPlodnice hřibu roste nad zemí.',
  existing: ['Co je podhoubí?'],
})

const otazka = (prompt: string, quote?: string) => ({
  type: 'short_answer',
  payload: { prompt, answer: 'chlorofyl' },
  ...(quote ? { evidence: { fileName: 'houby.pdf', quote } } : {}),
})

describe('soubor s otázkami z Claude Code', () => {
  it('přijme objekt s polem questions i holé pole', () => {
    const q = [otazka('Co houbám chybí?', 'Houby nemají chlorofyl.')]
    expect(readQuestionFile(JSON.stringify({ questions: q }), ZDROJ).questions).toHaveLength(1)
    expect(readQuestionFile(JSON.stringify(q), ZDROJ).questions).toHaveLength(1)
  })

  it('smí obsahovat i typy, které aplikace sama negeneruje', () => {
    const matching = {
      type: 'matching',
      payload: { left: ['hřib', 'muchomůrka'], right: ['jedlý', 'jedovatá'], pairs: [[0, 0], [1, 1]] },
    }
    expect(readQuestionFile(JSON.stringify([matching]), ZDROJ).questions).toHaveLength(1)
  })

  it('odmítne otázku s vymyšlenou citací, špatným tvarem, duplicitou a už existující otázku', () => {
    const { questions, rejected } = readQuestionFile(
      JSON.stringify([
        otazka('Co houbám chybí?', 'Houby nemají chlorofyl.'),
        otazka('Kde roste hřib?', 'Hřib roste jen v jehličnatém lese.'),
        { type: 'short_answer', payload: {} },
        otazka('co houbám chybí'),
        otazka('Co je podhoubí?'),
      ]),
      ZDROJ,
      existingPromptsFromSource(ZDROJ),
    )
    expect(questions).toHaveLength(1)
    expect(rejected.map((r) => r.index)).toEqual([1, 2, 3, 4])
  })

  it('neplatný JSON vysvětlí česky', () => {
    expect(() => readQuestionFile('{nejde', ZDROJ)).toThrow(/není platný JSON/)
  })

  it('zdrojový soubor nese předmět, ročník, téma a existující otázky', () => {
    expect(ZDROJ).toContain('# Ročník: 6. ročník')
    expect(ZDROJ).toContain('=== houby.pdf ===')
    expect(existingPromptsFromSource(ZDROJ)).toEqual(['Co je podhoubí?'])
  })
})
```

- [ ] **Krok 2: Ověřit, že padají**

Spustit: `cd packages/core && pnpm exec vitest run test/question-file.test.ts`
Očekávat: FAIL — modul neexistuje.

- [ ] **Krok 3: `questionFile.ts`**

```ts
import { z } from 'zod'
import { normalizeOrderingPayload, questionContentSchema, type QuestionContent } from '../schema/question'
import { checkQuestion, dedupeKey, promptOf, withDefaultPoints } from './generate'
import { buildSystemPrompt, QUESTION_TYPE_HINTS } from './prompts/questions'

/**
 * Otázky z Claude Code. Předplatné Claude Max se v aplikaci použít nedá,
 * v Claude Code ano: majitel si stáhne materiály tématu jako text, příkazem
 * `/otazky` nechá napsat otázky a soubor nahraje zpátky do tématu. Kontrola je
 * tatáž jako u generování v aplikaci (`checkQuestion`), jen typy nejsou
 * omezené — Claude zvládne i přiřazování a řazení.
 */
export const CLAUDE_CODE_MODEL = 'claude-code'

const EXISTING_HEADER = '# Otázky, které už v tématu jsou — nepiš je znovu:'

/** Text tématu pro Claude Code: hlavička s ročníkem a existujícími otázkami, pak materiály. */
export function buildTopicSourceFile(meta: {
  subjectName: string
  gradeName: string | null
  topicName: string
  text: string
  existing: string[]
}): string {
  const lines = [
    `# Předmět: ${meta.subjectName}`,
    `# Ročník: ${meta.gradeName || 'neurčen'}`,
    `# Téma: ${meta.topicName}`,
  ]
  if (meta.existing.length > 0) {
    lines.push(EXISTING_HEADER, ...meta.existing.map((prompt) => `# - ${prompt.replace(/\s+/g, ' ').trim()}`))
  }
  lines.push('', meta.text)
  return lines.join('\n')
}

/** Existující otázky z hlavičky zdrojového souboru. */
export function existingPromptsFromSource(source: string): string[] {
  const lines = source.split('\n')
  const start = lines.indexOf(EXISTING_HEADER)
  if (start === -1) return []
  const prompts: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('# - ')) break
    prompts.push(line.slice(4))
  }
  return prompts
}

/** Pravidla pro psaní otázek: týž systémový prompt jako v aplikaci, typy a přesný tvar (JSON Schema). */
export function buildQuestionRules(gradeName: string | null): string {
  const types = Object.entries(QUESTION_TYPE_HINTS)
    .filter(([type]) => type !== 'label_image')
    .map(([type, hint]) => `- ${type}: ${hint}`)
  return [
    buildSystemPrompt(gradeName),
    '',
    'Typy otázek (label_image nepoužívej):',
    ...types,
    '',
    'Soubor je JSON ve tvaru { "questions": [ … ] }, každá otázka odpovídá tomuto schématu:',
    JSON.stringify(z.toJSONSchema(questionContentSchema), null, 2),
  ].join('\n')
}

/**
 * Přečte soubor s otázkami a nechá jen ty, které projdou kontrolou tvaru,
 * doslovné citace (vůči zdrojovému textu) a duplicit — v souboru i vůči
 * otázkám, které už v tématu jsou.
 */
export function readQuestionFile(
  json: string,
  source: string,
  existing: string[] = [],
): { questions: QuestionContent[]; rejected: { index: number; errors: string[] }[] } {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Soubor není platný JSON. Nech ho v Claude Code zapsat znovu příkazem /otazky.')
  }
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { questions?: unknown })?.questions)
      ? (raw as { questions: unknown[] }).questions
      : null
  if (!list) throw new Error('V souboru chybí seznam otázek („questions").')

  const seen = new Set(existing.map(dedupeKey))
  const questions: QuestionContent[] = []
  const rejected: { index: number; errors: string[] }[] = []

  list.forEach((candidate, index) => {
    const parsed = questionContentSchema.safeParse(candidate)
    if (!parsed.success) {
      rejected.push({ index, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'otázka'}: ${i.message}`) })
      return
    }
    if (parsed.data.type === 'label_image') {
      rejected.push({ index, errors: ['popis obrázku se ze souboru nahrát nedá'] })
      return
    }
    const errors = checkQuestion(parsed.data, source)
    if (errors.length > 0) {
      rejected.push({ index, errors })
      return
    }
    const question = withDefaultPoints(normalizeOrderingPayload(parsed.data))
    const key = dedupeKey(promptOf(question))
    if (seen.has(key)) {
      rejected.push({ index, errors: ['stejná otázka už v tématu nebo v souboru je'] })
      return
    }
    seen.add(key)
    questions.push(question)
  })

  return { questions, rejected }
}
```

Do `index.ts`: `export * from './questionFile'`.

- [ ] **Krok 4: Ověřit testy**

Spustit: `cd packages/core && pnpm exec vitest run test/question-file.test.ts`
Očekávat: PASS. (Pokud `matching` v testu neprojde kvůli povinným polím schématu, doplnit do testu chybějící povinná pole podle `matchingPayloadSchema` — ne měnit schéma.)

- [ ] **Krok 5: Skripty**

`apps/web/scripts/env.ts` (přesunout sem `loadEnv` z `generate-bulk.ts` beze změny a v `generate-bulk.ts` ho importovat `import { loadEnv } from './env'`):

```ts
import { existsSync, readFileSync } from 'node:fs'

/** `.env.local` čte jen Next.js; skript spouštěný přes tsx si ho musí načíst sám. */
export function loadEnv(): void {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && match[1] && match[2] && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim()
    }
  }
}
```

`apps/web/scripts/otazky-pravidla.ts`:

```ts
/**
 * Vypíše pravidla pro psaní otázek (týž prompt jako v aplikaci) a přesný
 * tvar souboru. Volá ho skill /otazky v Claude Code.
 *
 *   pnpm --filter @testmaker/web otazky:pravidla "<ročník>"
 */
import { buildQuestionRules } from '@testmaker/core/ai'

console.log(buildQuestionRules(process.argv[2] ?? null))
```

`apps/web/scripts/otazky-over.ts`:

```ts
/**
 * Zkontroluje soubor s otázkami stejně, jako ho zkontroluje aplikace při
 * nahrání. Bez databáze — existující otázky bere z hlavičky zdrojového souboru.
 *
 *   pnpm --filter @testmaker/web otazky:over <zdroj.txt> <otazky.json>
 */
import { readFileSync } from 'node:fs'
import { existingPromptsFromSource, readQuestionFile } from '@testmaker/core/ai'

const [zdrojCesta, otazkyCesta] = process.argv.slice(2)
if (!zdrojCesta || !otazkyCesta) {
  console.error('Použití: otazky:over <zdroj.txt> <otazky.json>')
  process.exit(1)
}
const zdroj = readFileSync(zdrojCesta, 'utf8')
try {
  const { questions, rejected } = readQuestionFile(readFileSync(otazkyCesta, 'utf8'), zdroj, existingPromptsFromSource(zdroj))
  console.log(`V pořádku: ${questions.length}, odmítnuto: ${rejected.length}`)
  for (const r of rejected) console.log(`- otázka #${r.index}: ${r.errors.join('; ')}`)
  process.exit(rejected.length > 0 ? 1 : 0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
```

Do `apps/web/package.json` → `"scripts"`:

```json
    "otazky:pravidla": "tsx scripts/otazky-pravidla.ts",
    "otazky:over": "tsx scripts/otazky-over.ts",
```

- [ ] **Krok 6: Skill `/otazky`**

`.claude/skills/otazky/SKILL.md`:

```markdown
---
name: otazky
description: Napíše otázky do písemky z materiálů jednoho tématu TestMakeru a uloží je jako soubor k nahrání do tématu. Použij, když majitel řekne /otazky, pošle soubor stažený tlačítkem „Stáhnout materiály" nebo chce otázky přes Claude Code místo generování v aplikaci.
---

# Otázky do tématu z Claude Code

Vstupem je textový soubor z tématu (tlačítko „Stáhnout materiály" na stránce
tématu). Hlavička souboru (`# Předmět`, `# Ročník`, `# Téma`, případně
`# Otázky, které už v tématu jsou`) říká, pro koho píšeš a co už existuje.

1. Zeptej se na cestu k souboru, pokud ji majitel nedal. Přečti ho celý.
2. Zeptej se, kolik otázek a jakou obtížnost chce, pokud to neřekl
   (výchozí 10 otázek, promíchaná obtížnost 1–3).
3. Spusť `pnpm --filter @testmaker/web otazky:pravidla "<ročník z hlavičky>"`
   a řiď se vypsanými pravidly i tvarem. Jsou to tatáž pravidla, podle kterých
   generuje aplikace.
4. Vyber typy podle látky — smíš použít všechny kromě `label_image`
   (přiřazování na pojmy a jejich význam, řazení na postupy a vývoj).
   Ke každé otázce vyplň `evidence.quote` doslovnou větou ze souboru.
5. Než soubor zapíšeš, přečti každou otázku očima žáka daného ročníku:
   rozumí zadání napoprvé? Je čeština přirozená a bez chyb? Je správná
   odpověď jen jedna a stojí v materiálu? Co neprojde, přepiš.
6. Zapiš `<název zdroje>.otazky.json` vedle zdrojového souboru
   ve tvaru `{ "questions": [ … ] }`.
7. Spusť `pnpm --filter @testmaker/web otazky:over <zdroj.txt> <otazky.json>`.
   Odmítnuté otázky oprav (nejčastěji citace, která v textu doslova není)
   a kontrolu opakuj, dokud neskončí `odmítnuto: 0`.
8. Řekni majiteli, kde soubor je, a že ho nahraje na stránce tématu tlačítkem
   „Nahrát otázky".

Na databázi (`apps/web/local.db`) nikdy nesahej — soubor se do aplikace
dostává jedině nahráním v rozhraní.
```

Ověřit, že `.claude/skills/otazky/SKILL.md` není ignorovaný: `git check-ignore -v .claude/skills/otazky/SKILL.md` nesmí nic vypsat.

- [ ] **Krok 7: Ověřit**

Spustit: `pnpm test && pnpm typecheck`, pak ručně `pnpm --filter @testmaker/web otazky:pravidla "6. ročník" | head -20`
Očekávat: PASS; výpis začíná „Jsi učitel na české základní škole…".

- [ ] **Krok 8: Commit**

```bash
git add packages/core/src/ai/questionFile.ts packages/core/src/ai/index.ts packages/core/test/question-file.test.ts \
  apps/web/scripts/env.ts apps/web/scripts/otazky-pravidla.ts apps/web/scripts/otazky-over.ts \
  apps/web/scripts/generate-bulk.ts apps/web/package.json .claude/skills/otazky/SKILL.md
git commit -m "feat(ai): write questions in Claude Code with /otazky and check them like the app does

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 11: Stažení materiálů a nahrání otázek v aplikaci

**Soubory:**
- Vytvořit: `apps/web/src/lib/questionFile.ts`
- Vytvořit: `apps/web/src/app/api/topics/[id]/zdroj/route.ts`, `apps/web/src/app/api/topics/[id]/otazky-soubor/route.ts`
- Vytvořit: `apps/web/src/components/ClaudeCodeImport.tsx`
- Upravit: `apps/web/src/app/topics/[id]/TopicWorkspace.tsx`
- Test: `apps/web/test/question-file.test.ts`

**Rozhraní:**
- Konzumuje: `loadTopicSource(scope, topicId)` (`lib/generation.ts`, vrací `{ topicName, subjectName, gradeName, text, sources } | null`), `loadAvoidPrompts(scope, topicId)`, `insertQuestions(scope, items, { topicId, source, status })` (`lib/questions.ts`), `buildTopicSourceFile`, `readQuestionFile`, `CLAUDE_CODE_MODEL`.
- Produkuje: `topicSourceFile(scope, topicId): Promise<{ fileName: string; text: string } | null>`, `importQuestionFile(scope, topicId, json): Promise<{ created: number; rejected: { index: number; errors: string[] }[] } | null>`.
- Otázky se ukládají se stavem `draft` jako vygenerované (zrušení schvalování je krok 2 specu, ne tenhle plán).

- [ ] **Krok 1: Napsat padající test**

`apps/web/test/question-file.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db, questions } from '@/db'
import { importQuestionFile, topicSourceFile } from '@/lib/questionFile'
import { seedMaterial, seedTopic, UCET } from './helpers'

const TEXT = 'Houby nemají chlorofyl, a proto si potravu nevyrábějí samy. '.repeat(8)

describe('otázky z Claude Code', () => {
  it('stáhne text tématu s hlavičkou a nahraje zpátky jen platné otázky', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })

    const zdroj = await topicSourceFile(UCET, topicId)
    expect(zdroj?.text).toContain('=== houby.pdf ===')
    expect(zdroj?.text).toMatch(/^# Předmět: /)

    const vysledek = await importQuestionFile(
      UCET,
      topicId,
      JSON.stringify({
        questions: [
          {
            type: 'short_answer',
            payload: { prompt: 'Co houbám chybí?', answer: 'chlorofyl' },
            evidence: { fileName: 'houby.pdf', quote: 'Houby nemají chlorofyl' },
          },
          {
            type: 'short_answer',
            payload: { prompt: 'Kolik nohou má houba?', answer: 'jednu' },
            evidence: { fileName: 'houby.pdf', quote: 'Houba má jednu nohu.' },
          },
        ],
      }),
    )
    expect(vysledek?.created).toBe(1)
    expect(vysledek?.rejected).toHaveLength(1)

    const ulozene = await db.select().from(questions).where(eq(questions.topicId, topicId))
    expect(ulozene.map((q) => q.model)).toEqual(['claude-code'])
  })

  it('cizí téma se tváří jako neexistující', async () => {
    const { topicId } = await seedTopic()
    const cizi = { ...UCET, schoolId: 'jina-skola' }
    expect(await topicSourceFile(cizi, topicId)).toBeNull()
    expect(await importQuestionFile(cizi, topicId, '[]')).toBeNull()
  })
})
```

- [ ] **Krok 2: Ověřit, že padá**

Spustit: `cd apps/web && pnpm exec vitest run test/question-file.test.ts`
Očekávat: FAIL — modul `@/lib/questionFile` neexistuje.

- [ ] **Krok 3: `lib/questionFile.ts`**

```ts
import { inArray } from 'drizzle-orm'
import { buildTopicSourceFile, CLAUDE_CODE_MODEL, readQuestionFile } from '@testmaker/core/ai'
import { db, questions } from '@/db'
import { loadTopicSource } from './generation'
import { insertQuestions, loadAvoidPrompts } from './questions'
import type { Scope } from './uzivatel'

/**
 * Text tématu ke stažení pro Claude Code (`/otazky`). Stejný text, jaký
 * dostává model při generování v aplikaci, s hlavičkou o ročníku
 * a otázkách, které už v tématu jsou. Cizí téma → `null`.
 */
export async function topicSourceFile(scope: Scope, topicId: string): Promise<{ fileName: string; text: string } | null> {
  const source = await loadTopicSource(scope, topicId)
  if (!source) return null
  const existing = await loadAvoidPrompts(scope, topicId)
  return {
    fileName: `${source.topicName}.txt`,
    text: buildTopicSourceFile({
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      topicName: source.topicName,
      text: source.text,
      existing,
    }),
  }
}

/**
 * Nahraje otázky ze souboru z Claude Code. Kontrola je tatáž jako při
 * generování (tvar, doslovná citace, duplicity); co neprojde, vrátí se
 * s důvodem. Cizí téma → `null`.
 */
export async function importQuestionFile(
  scope: Scope,
  topicId: string,
  json: string,
): Promise<{ created: number; rejected: { index: number; errors: string[] }[] } | null> {
  const source = await loadTopicSource(scope, topicId)
  if (!source) return null
  const existing = await loadAvoidPrompts(scope, topicId)
  const { questions: accepted, rejected } = readQuestionFile(json, source.text, existing)
  const ids = await insertQuestions(scope, accepted, { topicId, source: 'ai', status: 'draft' })
  // Odkud otázka je, se ukládá jen do databáze pro srovnání kvality (jako u generování).
  if (ids.length > 0) await db.update(questions).set({ model: CLAUDE_CODE_MODEL }).where(inArray(questions.id, ids))
  return { created: ids.length, rejected }
}
```

Pokud typ `Scope` žije jinde než v `./uzivatel`, vzít import z `lib/generation.ts`, který ho používá.

- [ ] **Krok 4: Routy**

`apps/web/src/app/api/topics/[id]/zdroj/route.ts`:

```ts
import { topicSourceFile } from '@/lib/questionFile'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/** Materiály tématu jako text pro Claude Code (`/otazky`). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return sRozsahem(async (ucet) => {
    const { id } = await params
    const file = await topicSourceFile(ucet, id)
    if (!file) return Response.json({ error: 'Téma se nenašlo' }, { status: 404 })
    return new Response(file.text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="tema.txt"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      },
    })
  })
}
```

`apps/web/src/app/api/topics/[id]/otazky-soubor/route.ts`:

```ts
import { importQuestionFile } from '@/lib/questionFile'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/** Nahraje soubor s otázkami z Claude Code do tématu. Tělo požadavku je obsah souboru. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return sRozsahem(
    async (ucet) => {
      const { id } = await params
      try {
        const result = await importQuestionFile(ucet, id, await request.text())
        if (!result) return Response.json({ error: 'Téma se nenašlo' }, { status: 404 })
        return Response.json(result)
      } catch (error) {
        // readQuestionFile hází jen srozumitelné české hlášky o obsahu souboru.
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
      }
    },
    { zapis: true },
  )
}
```

- [ ] **Krok 5: Komponenta a její místo v tématu**

`apps/web/src/components/ClaudeCodeImport.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, OTAZKY, pocet, toast } from '@testmaker/ui'

/**
 * Otázky napsané v Claude Code (`/otazky`): stáhnout materiály tématu
 * jako text a nahrát zpátky hotový soubor. Funguje i bez modelu v aplikaci.
 */
export function ClaudeCodeImport({ topicId }: { topicId: string }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const base = `/api/topics/${encodeURIComponent(topicId)}`

  async function upload(file: File) {
    setBusy(true)
    try {
      const response = await fetch(`${base}/otazky-soubor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await file.text(),
      })
      const data = (await response.json()) as { created?: number; rejected?: unknown[]; error?: string }
      if (!response.ok) {
        toast.error(data.error ?? 'Otázky se nepodařilo nahrát.')
        return
      }
      const odmitnuto = data.rejected?.length ?? 0
      toast.success(
        `Nahráno ${pocet(data.created ?? 0, OTAZKY)}` +
          (odmitnuto > 0 ? `, ${odmitnuto} neprošlo kontrolou (spusť v Claude Code otazky:over)` : ''),
      )
      router.refresh()
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
      <span>Otázky z Claude Code:</span>
      <Button asChild variant="outline" size="sm">
        <a href={`${base}/zdroj`} download>
          Stáhnout materiály
        </a>
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Nahrávám…' : 'Nahrát otázky'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />
    </div>
  )
}
```

V `apps/web/src/app/topics/[id]/TopicWorkspace.tsx` importovat `import { ClaudeCodeImport } from '@/components/ClaudeCodeImport'` a hned za uzavírací část bloku `{ai.configured && muzeMenit ? (<Card …>…</Card>) : …}` (tedy mimo podmínku `ai.configured`, uvnitř `<div className="space-y-5">`) vložit:

```tsx
      {muzeMenit ? <ClaudeCodeImport topicId={topicId} /> : null}
```

(Pokud `pocet`/`OTAZKY` nevrací tvar „10 otázek", použít ve zprávě prosté číslo.)

- [ ] **Krok 6: Ověřit**

Spustit: `pnpm test && pnpm typecheck && pnpm build`
Očekávat: PASS. Pak ručně proti testovacímu serveru (ne proti portu 3000): `cd apps/web && pnpm exec playwright test e2e/stranka.spec.ts` musí dál projít; v prohlížeči na serveru z Playwrightu (port 3100) otevřít zkušební téma, stáhnout materiály a nahrát soubor `[]` → hláška „Nahráno 0 otázek".

- [ ] **Krok 7: Commit**

```bash
git add apps/web/src/lib/questionFile.ts "apps/web/src/app/api/topics/[id]/zdroj/route.ts" \
  "apps/web/src/app/api/topics/[id]/otazky-soubor/route.ts" apps/web/src/components/ClaudeCodeImport.tsx \
  "apps/web/src/app/topics/[id]/TopicWorkspace.tsx" apps/web/test/question-file.test.ts
git commit -m "feat(web): download topic materials and upload questions from Claude Code

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 12: Zkušební generování do Markdownu (srovnávací základ)

**Soubory:**
- Vytvořit: `apps/web/scripts/zkouska-generovani.ts`
- Upravit: `apps/web/package.json`

**Rozhraní:**
- Konzumuje: `generateQuestions`, `readAiLadder`, `describeAiConfig`, `AI_QUESTION_TYPES`, `loadEnv` (`scripts/env.ts`). Bez databáze.

- [ ] **Krok 1: Skript**

```ts
/**
 * Zkušební generování bez databáze: z textového souboru vygeneruje otázky
 * modelem z AI_MODELS a zapíše je do Markdownu k ručnímu hodnocení.
 * Slouží ke srovnání modelů a změn generování — a k porovnání s /otazky.
 *
 *   pnpm --filter @testmaker/web generate:try <soubor.txt> "<ročník>" "<předmět>" "<téma>" [počet]
 *
 * Soubor stáhni v tématu tlačítkem „Stáhnout materiály" (nebo ulož text se
 * záhlavím `=== název ===`).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { AI_QUESTION_TYPES, type QuestionContent } from '@testmaker/core/schema'
import { describeAiConfig, generateQuestions, readAiLadder } from '@testmaker/core/ai'
import { loadEnv } from './env'

function popis(q: QuestionContent): string {
  switch (q.type) {
    case 'single_choice':
      return [q.payload.prompt, ...q.payload.options.map((o, i) => `   ${i === q.payload.correctIndex ? '**✓**' : '·'} ${o}`)].join('\n')
    case 'true_false':
      return [q.payload.prompt, ...q.payload.statements.map((s) => `   ${s.isTrue ? 'P' : 'N'} — ${s.text}`)].join('\n')
    case 'short_answer':
      return `${q.payload.prompt}\n   Odpověď: **${q.payload.answer}**${
        q.payload.acceptedAnswers.length ? ` (také: ${q.payload.acceptedAnswers.join(', ')})` : ''
      }`
    default:
      return `\`\`\`json\n${JSON.stringify(q.payload, null, 2)}\n\`\`\``
  }
}

async function main() {
  loadEnv()
  const [soubor, rocnik, predmet, tema, pocet] = process.argv.slice(2)
  if (!soubor || !rocnik || !predmet || !tema) {
    console.error('Použití: generate:try <soubor.txt> "<ročník>" "<předmět>" "<téma>" [počet]')
    process.exit(1)
  }
  const ladder = readAiLadder()
  console.log(`žebříček: ${ladder.map(describeAiConfig).join(' → ') || '— (chybí klíč nebo AI_MODELS)'}`)
  const text = await readFile(soubor, 'utf8')
  const start = Date.now()
  const vysledek = await generateQuestions(
    {
      text,
      topicName: tema,
      subjectName: predmet,
      gradeName: rocnik,
      count: Number(pocet) || 10,
      types: [...AI_QUESTION_TYPES],
      difficulty: 'mix',
    },
    { models: ladder },
  )

  const radky = [
    `# Zkušební generování — ${tema} (${rocnik})`,
    '',
    `Model: ${vysledek.models.join(', ') || '—'} · úseků: ${vysledek.chunks} · za ${Math.round((Date.now() - start) / 1000)} s`,
    `Přijato: ${vysledek.questions.length} · zahozeno: ${vysledek.rejected.length} · neúspěšná volání: ${vysledek.failedCalls.length}`,
    '',
    'U každé otázky zaškrtni, jestli by šla do písemky beze změny.',
    '',
    ...vysledek.questions.flatMap((q, i) => [
      `## ${i + 1}. ${q.type} · obtížnost ${q.difficulty}`,
      '',
      '- [ ] dobrá beze změny',
      '',
      popis(q),
      '',
      q.explanation ? `> Vysvětlení: ${q.explanation}` : '',
      q.evidence ? `> Citace (${q.evidence.fileName}): ${q.evidence.quote}` : '> Citace: —',
      '',
    ]),
    ...(vysledek.rejected.length
      ? ['## Zahozené', '', ...vysledek.rejected.map((r) => `- #${r.index}: ${r.errors.join('; ')}`)]
      : []),
  ]
  const vystup = `${soubor.replace(/\.[^.]+$/, '')}.otazky.md`
  await writeFile(vystup, radky.join('\n'))
  console.log(`Zapsáno: ${vystup}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Krok 2: `package.json`**

Do `apps/web/package.json` → `"scripts"`: `"generate:try": "tsx scripts/zkouska-generovani.ts",`

- [ ] **Krok 3: Ověřit a commit**

Spustit: `pnpm typecheck`
Očekávat: bez chyb.

```bash
git add apps/web/scripts/zkouska-generovani.ts apps/web/package.json
git commit -m "feat(ai): add a dry-run script to rate generated questions by hand

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Krok 4: Ruční ověření s majitelem (ne automaticky)**

Dělá majitel — sahá na skutečný klíč a skutečný materiál:
1. Ověřit typ Google klíče (AI Studio → API keys → Key Type = Auth).
2. V aplikaci u jednoho kratšího tématu „Stáhnout materiály" → `~/zkouska/houby.txt`.
3. `pnpm --filter @testmaker/web generate:try ~/zkouska/houby.txt "6. ročník" "Přírodopis" "Houby" 10` → `houby.otazky.md`.
4. V Claude Code `/otazky ~/zkouska/houby.txt` → `houby.otazky.json`.
5. Učitelka ohodnotí obě sady; podle výsledku se rozhodne, jestli do `AI_MODELS` přidat placený model přes OpenRouter a jaký.

---

## Po dokončení

- `pnpm test`, `pnpm typecheck`, `pnpm build` v kořeni.
- Pokud se úkol 3 přeskočil, připomenout majiteli, že hlavolamy mají ještě vlastní kopii volání modelu a čekají na commit jeho rozpracovaných změn.
