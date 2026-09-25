# Kvalita generování — plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cíl:** Aby lokální model (`qwen3:14b` přes Ollamu) viděl celé zadání, dostával malé zvládnutelné úseky a jen jednoduché typy otázek, a aby se otázky s vymyšlenou citací zahodily dřív, než se dostanou do banky.

**Architektura:** Všechny změny jsou v `packages/core/src/ai` a `packages/core/src/schema/question.ts` — generování zůstává jedna funkce `generateQuestions`. Kontext Ollamy se předává přes `providerOptions` volání `generateObject`. Kontrola citace a normalizovaná deduplikace se přidávají jako malé čisté funkce v `generate.ts`, které používají obě cesty (žebříček i paralelní workeři). Nakonec skript ve webu, který vygeneruje otázky z textového souboru do Markdownu k ručnímu hodnocení — bez databáze.

**Tech stack:** TypeScript, AI SDK (`ai` 7, `generateObject`), `ollama-ai-provider-v2` 4.0.1, zod 4, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-09-25-zjednoduseni-ucitelka-design.md`, kapitola „Kvalita generování".

## Globální omezení

- Kód, komentáře a texty jsou česky; commity anglicky podle Conventional Commits, zakončené řádkem `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Žádný test ani skript nesmí sahat na `apps/web/local.db`. Testy nesmějí volat skutečný model — volání se podstrkuje přes `callModel`.
- Tvar otázky určuje jediné zod schéma v `packages/core/src/schema`; žádná druhá definice.
- Výchozí `num_ctx` je 16 384, přepsatelné proměnnou `OLLAMA_NUM_CTX`.
- Úsek materiálu do jednoho volání má nejvýš 8 000 znaků.
- AI generuje jen `single_choice`, `true_false`, `short_answer`.
- Rozpracované změny v `packages/core/src/ai/puzzleWords.ts`, `packages/core/src/pdf/PuzzleBody.tsx` a `packages/ui/src/PaperPuzzle.tsx` patří majiteli — nestageovat, needitovat. Do commitů přidávat vždy jen vyjmenované soubory (`git add <soubor>`), nikdy `git add -A`.
- Ověření po každém úkolu: `pnpm test` a `pnpm typecheck` v kořeni repozitáře.

## Na co si dát pozor při revizi

1. **Úloha z fronty se starými typy** (`matching`, `open`… uložené v `generation_jobs` před změnou) — generování je musí tiše zúžit na povolené typy, ne vyrábět `matching`. Test v úkolu 2.
2. **Text z PDF bez prázdných řádků** — celý dokument je jeden „odstavec" a úsek by měl desítky tisíc znaků. Dělení musí padnout na řádky a věty. Test v úkolu 3.
3. **Dlouhý materiál a málo otázek** (25 úseků, 10 otázek) — otázky se nesmějí brát jen ze začátku materiálu. Test v úkolu 3.
4. **Citace s drobnou odchylkou** (jiné uvozovky, tečka na konci, „…" uprostřed, zalomení řádku) — nesmí vést k zahození, jinak z modelu nezbude nic. Test v úkolu 4.
5. **Pozdější úsek souboru bez záhlaví `=== soubor ===`** — model pak nemá odkud vzít `evidence.fileName`. Záhlaví se musí přenést do každého úseku. Test v úkolu 3.

---

### Úkol 1: Kontext Ollamy (`num_ctx`)

**Soubory:**
- Upravit: `packages/core/src/ai/provider.ts` (na konec souboru)
- Upravit: `packages/core/src/ai/generate.ts` (import a volání `generateObject` v `generateQuestions`)
- Test: `packages/core/test/ai.test.ts`

**Rozhraní:**
- Produkuje: `DEFAULT_OLLAMA_NUM_CTX: number`, `readOllamaNumCtx(env?): number`, `providerOptionsFor(config: AiConfig, env?): { ollama: { options: { num_ctx: number } } } | undefined`

- [ ] **Krok 1: Napsat padající test**

Do `packages/core/test/ai.test.ts` přidat import `providerOptionsFor, readOllamaNumCtx` z `'../src/ai/provider'` (rozšířit existující řádek s `readAiConfig, isAiConfigured`) a na konec souboru:

```ts
describe('kontext Ollamy', () => {
  it('bez nastavení použije 16 384 tokenů', () => {
    expect(readOllamaNumCtx({})).toBe(16_384)
  })

  it('OLLAMA_NUM_CTX přebije výchozí hodnotu', () => {
    expect(readOllamaNumCtx({ OLLAMA_NUM_CTX: '32768' })).toBe(32_768)
  })

  it('nesmyslnou hodnotu ignoruje', () => {
    expect(readOllamaNumCtx({ OLLAMA_NUM_CTX: 'hodně' })).toBe(16_384)
    expect(readOllamaNumCtx({ OLLAMA_NUM_CTX: '512' })).toBe(16_384)
  })

  it('Ollama dostane num_ctx, ostatní poskytovatelé nic', () => {
    expect(providerOptionsFor({ provider: 'ollama', model: 'qwen3:14b' }, {})).toEqual({
      ollama: { options: { num_ctx: 16_384 } },
    })
    expect(providerOptionsFor({ provider: 'google', model: 'gemini-flash-latest' }, {})).toBeUndefined()
  })
})
```

- [ ] **Krok 2: Ověřit, že test padá**

Spustit: `cd packages/core && pnpm exec vitest run test/ai.test.ts -t "kontext Ollamy"`
Očekávat: FAIL — `readOllamaNumCtx is not a function` (nebo chyba importu).

- [ ] **Krok 3: Implementace v `provider.ts`**

Na konec `packages/core/src/ai/provider.ts`:

```ts
/**
 * Kolik tokenů smí Ollama držet v kontextu. Bez výslovného nastavení běží
 * model s kontextem jen pár tisíc tokenů a delší prompt Ollama bez varování
 * ořízne zepředu — model pak nevidí pravidla ze systémového promptu ani část
 * materiálu a otázky si vymýšlí. 16 384 pojme úsek materiálu, prompt i odpověď
 * s rezervou; víc stojí paměť na workeru, proto jde přebít `OLLAMA_NUM_CTX`.
 */
export const DEFAULT_OLLAMA_NUM_CTX = 16_384

/** Menší kontext než 2 048 nedává smysl ani pro samotná pravidla. */
const MIN_OLLAMA_NUM_CTX = 2_048

export function readOllamaNumCtx(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.OLLAMA_NUM_CTX)
  return Number.isInteger(value) && value >= MIN_OLLAMA_NUM_CTX ? value : DEFAULT_OLLAMA_NUM_CTX
}

/** Nastavení volání, které se liší podle poskytovatele; zatím jen kontext Ollamy. */
export function providerOptionsFor(
  config: AiConfig,
  env: Record<string, string | undefined> = process.env,
): { ollama: { options: { num_ctx: number } } } | undefined {
  if (config.provider !== 'ollama') return undefined
  return { ollama: { options: { num_ctx: readOllamaNumCtx(env) } } }
}
```

- [ ] **Krok 4: Předat nastavení do `generateObject`**

V `packages/core/src/ai/generate.ts` rozšířit import:

```ts
import { describeAiConfig, getModel, providerOptionsFor, readAiLadder, type AiConfig } from './provider'
```

a ve výchozím `callModel` uvnitř `generateQuestions` doplnit `providerOptions`:

```ts
      const { object } = await generateObject({
        model,
        schema: responseSchema,
        system,
        prompt,
        abortSignal: signal,
        maxRetries: 2,
        providerOptions: providerOptionsFor(config),
      })
```

- [ ] **Krok 5: Ověřit, že testy procházejí**

Spustit: `cd packages/core && pnpm exec vitest run test/ai.test.ts && cd ../.. && pnpm typecheck`
Očekávat: PASS, typecheck bez chyb. Ověřit, že provider klíč `ollama` opravdu čte: `grep -n "providerOptions\|num_ctx" node_modules/.pnpm/ollama-ai-provider-v2@*/node_modules/ollama-ai-provider-v2/dist/index.mjs | head` — musí se ukázat čtení `providerOptions` pod jménem `ollama` a předání `options` do požadavku; kdyby se četlo pod jiným klíčem, použít ten. Kdyby typecheck u `providerOptions` hlásil nekompatibilní typ, zúžit návratový typ `providerOptionsFor` na `Record<string, Record<string, JSONValue>> | undefined` s `import type { JSONValue } from '@ai-sdk/provider'` — hodnota zůstává stejná.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/ai/provider.ts packages/core/src/ai/generate.ts packages/core/test/ai.test.ts
git commit -m "fix(ai): give Ollama a context window that fits the prompt

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 2: AI generuje jen tři jednoduché typy

**Soubory:**
- Upravit: `packages/core/src/schema/question.ts:33-34`
- Upravit: `packages/core/src/ai/generate.ts` (začátek `generateQuestions`, výpočet `typeSchedule`)
- Test: `packages/core/test/ai-ladder.test.ts`

**Rozhraní:**
- Produkuje: `AI_QUESTION_TYPES: readonly ['single_choice', 'true_false', 'short_answer']` (typ `AiQuestionType`), `onlyAiTypes(types: QuestionType[]): QuestionType[]` v `generate.ts`.
- Web už `AI_QUESTION_TYPES` používá (`GenerateDialog`, `api/generate`, `api/jobs`, `useRegenerateQuestion`, `lib/generation.ts`) — nabídka v dialogu se zúží sama a přegenerování otázky nepodporovaného typu se samo vypne.

- [ ] **Krok 1: Napsat padající test**

Na konec `packages/core/test/ai-ladder.test.ts`:

```ts
describe('typy otázek pro AI', () => {
  it('úloha se starým typem z fronty generuje jen povolené typy', async () => {
    const pozadovane: string[] = []
    const call: ModelCall = async ({ prompt }) => {
      pozadovane.push(prompt)
      return { questions: [otazka(1)] }
    }
    await generateQuestions(
      { ...ZADANI, count: 2, types: ['matching', 'short_answer'] },
      { config: PRVNI, callModel: call },
    )
    expect(pozadovane.join('\n')).not.toContain('matching')
    expect(pozadovane.join('\n')).toContain('short_answer')
  })

  it('bez jediného povoleného typu použije všechny povolené', async () => {
    const pozadovane: string[] = []
    const call: ModelCall = async ({ prompt }) => {
      pozadovane.push(prompt)
      return { questions: [otazka(1)] }
    }
    await generateQuestions({ ...ZADANI, count: 3, types: ['matching'] }, { config: PRVNI, callModel: call })
    const vse = pozadovane.join('\n')
    expect(vse).not.toContain('matching')
    expect(vse).toContain('single_choice')
  })
})
```

Pozn.: `ZADANI.types` je `readonly ['short_answer']`; kdyby TypeScript v testu protestoval proti přepisu `types`, použít `types: ['matching', 'short_answer'] as QuestionType[]` a přidat `type QuestionType` do importu z `'../src/schema/question'`.

- [ ] **Krok 2: Ověřit, že test padá**

Spustit: `cd packages/core && pnpm exec vitest run test/ai-ladder.test.ts -t "typy otázek pro AI"`
Očekávat: FAIL — prompt obsahuje `matching`.

- [ ] **Krok 3: Zúžit `AI_QUESTION_TYPES`**

V `packages/core/src/schema/question.ts` nahradit řádky 33–34:

```ts
/**
 * Typy, které smí generovat AI. Jen ty jednoduché: u přiřazování, řazení,
 * tabulek a doplňování se menší modely pletou v indexech a počtech a vzniká
 * klíč, který nedává smysl. Ostatní typy zůstávají pro ruční tvorbu.
 */
export const AI_QUESTION_TYPES = ['single_choice', 'true_false', 'short_answer'] as const satisfies readonly QuestionType[]

export type AiQuestionType = (typeof AI_QUESTION_TYPES)[number]
```

- [ ] **Krok 4: Filtr v `generateQuestions`**

V `packages/core/src/ai/generate.ts` rozšířit import ze `'../schema/question'` o `AI_QUESTION_TYPES` a nad `generateQuestions` přidat:

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

a v `generateQuestions` hned na začátku těla (před `const ladder =`) přepsat požadavek:

```ts
  request = { ...request, types: onlyAiTypes(request.types) }
```

- [ ] **Krok 5: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS. Test „pokryje všechny typy, které smí AI generovat" v `ai.test.ts` prochází dál (iteruje přes zúžený seznam). Kdyby typecheck ve webu hlásil chybu u `AI_QUESTION_TYPES.includes(type as …)` v `apps/web/src/lib/generation.ts:306`, přetypovat na `(AI_QUESTION_TYPES as readonly string[]).includes(type)` stejně jako v `useRegenerateQuestion.ts:45`.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/schema/question.ts packages/core/src/ai/generate.ts packages/core/test/ai-ladder.test.ts
# případně i apps/web/src/lib/generation.ts, pokud se měnil v kroku 5
git commit -m "fix(ai): generate only the question types small models get right

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 3: Malé úseky materiálu

**Soubory:**
- Upravit: `packages/core/src/ai/generate.ts` (`MAX_CHARS_PER_CALL`, `chunkText`, nová `pickChunks`, řádek `const chunks = chunkText(request.text)`)
- Test: `packages/core/test/ai.test.ts` (blok `describe('dělení dlouhých materiálů'`)

**Rozhraní:**
- Produkuje: `chunkText(text: string, maxChars?: number): string[]` (stejná signatura, nové chování), `pickChunks(chunks: string[], count: number): string[]`, `MAX_CHARS_PER_CALL = 8_000`.

- [ ] **Krok 1: Napsat padající testy**

Do importu v `packages/core/test/ai.test.ts` přidat `pickChunks`. Do bloku `describe('dělení dlouhých materiálů', …)` přidat:

```ts
  it('výchozí úsek má nejvýš 8 000 znaků', () => {
    const text = `${'Věta o vodě. '.repeat(50)}\n\n`.repeat(40)
    for (const chunk of chunkText(text)) expect(chunk.length).toBeLessThanOrEqual(8_000)
  })

  it('text bez prázdných řádků rozdělí po řádcích a větách', () => {
    const text = 'Voda se vypařuje z hladiny moří. '.repeat(300)
    const chunks = chunkText(text, 1000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1000)
    expect(chunks.join(' ').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
  })

  it('záhlaví souboru přenese do každého dalšího úseku téhož souboru', () => {
    const odstavec = `${'b'.repeat(400)}\n\n`
    const text = `=== voda.pdf ===\n${odstavec.repeat(5)}=== vzduch.pdf ===\n${odstavec.repeat(5)}`
    const chunks = chunkText(text, 1000)
    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks) expect(chunk).toMatch(/^=== (voda|vzduch)\.pdf ===/)
    expect(chunks.at(-1)).toMatch(/^=== vzduch\.pdf ===/)
  })
})

describe('výběr úseků', () => {
  it('při dostatku otázek bere všechny úseky', () => {
    expect(pickChunks(['a', 'b', 'c'], 10)).toEqual(['a', 'b', 'c'])
  })

  it('při málo otázkách rozloží výběr po celém materiálu, ne jen od začátku', () => {
    const chunks = Array.from({ length: 25 }, (_, i) => `u${i}`)
    const picked = pickChunks(chunks, 10)
    expect(picked).toHaveLength(10)
    expect(picked[0]).toBe('u0')
    expect(Number(picked.at(-1)!.slice(1))).toBeGreaterThanOrEqual(20)
    expect(new Set(picked).size).toBe(10)
  })
```

(Poslední `})` v prvním bloku nahrazuje původní uzavírací závorku bloku `dělení dlouhých materiálů`.)

- [ ] **Krok 2: Ověřit, že testy padají**

Spustit: `cd packages/core && pnpm exec vitest run test/ai.test.ts -t "úsek|výběr úseků|záhlaví|bez prázdných"`
Očekávat: FAIL — `pickChunks` neexistuje, úseky jsou delší než limit.

- [ ] **Krok 3: Implementace**

V `packages/core/src/ai/generate.ts` nahradit konstantu a `chunkText`:

```ts
/**
 * Maximální délka materiálu v jednom volání. Malý model s úsekem o pár
 * stranách pracuje přesně; se stovkou stran se ztratí a začne vymýšlet.
 * 8 000 znaků je zhruba 3 000 tokenů — s pravidly a odpovědí se to vejde
 * do kontextu Ollamy (viz `DEFAULT_OLLAMA_NUM_CTX`) s rezervou.
 */
const MAX_CHARS_PER_CALL = 8_000

const FILE_HEADER = /^=== .+ ===$/

/**
 * Rozdělí příliš dlouhý kus textu na části do `maxChars`: nejdřív po řádcích,
 * a když je i řádek moc dlouhý (text z PDF bývá jeden nekonečný řádek), po
 * větách. Věta delší než limit zůstane celá — rozsekat ji uprostřed by
 * modelu vzalo smysl.
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
 * `evidence.fileName` a bez něj by v pozdějších částech nevěděl, odkud text je.
 */
export function chunkText(text: string, maxChars = MAX_CHARS_PER_CALL): string[] {
  if (text.length <= maxChars) return [text]
  const parts: string[] = []
  let current = ''
  let header: string | null = null

  for (const paragraph of text.split(/\n\n+/)) {
    const firstLine = (paragraph.split('\n', 1)[0] ?? '').trim()
    const startsWithHeader = FILE_HEADER.test(firstLine)
    if (startsWithHeader) header = firstLine

    for (const piece of splitLong(paragraph, maxChars)) {
      if (current.length + piece.length + 2 > maxChars && current.trim() && current.trim() !== header) {
        parts.push(current.trim())
        const pieceHasHeader = FILE_HEADER.test((piece.split('\n', 1)[0] ?? '').trim())
        current = header && !pieceHasHeader ? `${header}\n` : ''
      }
      current += `${piece}\n\n`
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/**
 * Když je úseků víc než otázek, vybere je rovnoměrně po celém materiálu.
 * Jinak by u dlouhého tématu a pár otázek padly všechny na první kapitoly.
 */
export function pickChunks(chunks: string[], count: number): string[] {
  if (chunks.length <= count) return chunks
  return Array.from({ length: count }, (_, i) => chunks[Math.floor((i * chunks.length) / count)] as string)
}
```

a v `generateQuestions` řádek `const chunks = chunkText(request.text)` nahradit:

```ts
  const chunks = pickChunks(chunkText(request.text), request.count)
```

Pozn. k testu „záhlaví …": úsek, který by obsahoval jen samotné záhlaví, se neuzavírá (podmínka `current.trim() !== header`), aby nevznikl prázdný úsek se záhlavím.

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS včetně původního testu „dělí na hranicích odstavců". Úsek smí obsahovat konec jednoho souboru a začátek dalšího (i s jeho záhlavím uprostřed); test hlídá jen to, že každý úsek začíná záhlavím.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ai/generate.ts packages/core/test/ai.test.ts
git commit -m "fix(ai): feed the model a few pages at a time from the whole topic

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 4: Otázka s vymyšlenou citací se zahodí

**Soubory:**
- Upravit: `packages/core/src/ai/generate.ts` (nové funkce `evidenceMatches`, `checkQuestion`; obě smyčky validace v `generateQuestions`)
- Test: `packages/core/test/ai.test.ts`, `packages/core/test/ai-ladder.test.ts`

**Rozhraní:**
- Konzumuje: `validateQuestionContent(q): string[]` ze schématu.
- Produkuje: `evidenceMatches(question: QuestionContent, chunk: string): boolean`, `checkQuestion(question: QuestionContent, chunk: string): string[]`, konstantu `EVIDENCE_NOT_FOUND = 'citace v evidence se v materiálu nenašla'`.

Pravidlo: otázka **bez** citace projde (normalizeEvidence ji uloží bez dokladu); otázka **s** citací, která se v úseku nenajde, se zahodí — vymyšlená citace je nejspolehlivější znak vymyšlené odpovědi.

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
    const vysledek = await generateQuestions({ ...ZADANI, count: 2 }, { config: PRVNI, callModel: call })
    expect(vysledek.questions.map((q) => (q.payload as { prompt: string }).prompt)).toEqual(['Otázka číslo 1?'])
    expect(vysledek.rejected[0]?.errors).toContain('citace v evidence se v materiálu nenašla')
  })
})
```

- [ ] **Krok 2: Ověřit, že testy padají**

Spustit: `cd packages/core && pnpm exec vitest run test/ai.test.ts test/ai-ladder.test.ts -t "citace"`
Očekávat: FAIL — `evidenceMatches` neexistuje; v generování projdou obě otázky.

- [ ] **Krok 3: Implementace**

V `packages/core/src/ai/generate.ts` nad `generateQuestions`:

```ts
export const EVIDENCE_NOT_FOUND = 'citace v evidence se v materiálu nenašla'

/** Nejkratší kus citace, který má smysl hledat; kratší by se našel kdekoli. */
const MIN_EVIDENCE_PART = 8

/**
 * Text pro porovnání citace s materiálem: bez rozdílu velikosti písmen,
 * uvozovek a bílých znaků. Model citaci opisuje a drobnosti mění — jiné
 * uvozovky, zalomení řádku, chybějící tečka — a kvůli tomu se otázka zahodit
 * nesmí.
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
 * Stojí citace z `evidence` opravdu v úseku materiálu? Citace se dělí na
 * vypuštění („…", „...") a každý kus musí být v textu. Otázka bez citace
 * projde — chybějící doklad je slabší prohřešek než vymyšlený.
 */
export function evidenceMatches(question: QuestionContent, chunk: string): boolean {
  const quote = question.evidence?.quote?.trim()
  if (!quote) return true
  const haystack = normalizeForMatch(chunk)
  const parts = quote
    .split(/…|\.\.\./)
    .map((part) => normalizeForMatch(part).replace(/[.,;:!?]+$/, '').trim())
    .filter((part) => part.length >= MIN_EVIDENCE_PART)
  if (parts.length === 0) return true
  return parts.every((part) => haystack.includes(part))
}

/** Všechny důvody, proč otázku nepustit do banky. */
export function checkQuestion(question: QuestionContent, chunk: string): string[] {
  const errors = validateQuestionContent(question)
  if (!evidenceMatches(question, chunk)) errors.push(EVIDENCE_NOT_FOUND)
  return errors
}
```

V cestě s workery nahradit `const errors = validateQuestionContent(question)` za:

```ts
        const errors = checkQuestion(question, item.task.chunk)
```

V sekvenční cestě (smyčka `for (const [i, question] of produced.entries())`) nahradit `const errors = validateQuestionContent(question)` za:

```ts
        const errors = checkQuestion(question, chunk)
```

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS. Stávající testy žebříčku mají otázky bez `evidence`, takže projdou beze změny.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ai/generate.ts packages/core/test/ai.test.ts packages/core/test/ai-ladder.test.ts
git commit -m "fix(ai): drop questions whose quoted evidence is not in the material

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 5: Paralelní workeři si předávají hotová zadání

**Soubory:**
- Upravit: `packages/core/src/ai/generate.ts` (nová `dedupeKey`; cesta s workery — sestavení promptu a `seenPrompts`; sekvenční cesta — deduplikace)
- Test: `packages/core/test/ai-ladder.test.ts`

**Rozhraní:**
- Konzumuje: `promptOf(question): string` (existuje).
- Produkuje: `dedupeKey(text: string): string`.

- [ ] **Krok 1: Napsat padající testy**

Na konec `ai-ladder.test.ts`:

```ts
describe('paralelní workeři', () => {
  const WORKERI = [
    { provider: 'ollama', model: 'm', baseURL: 'http://a/api' },
    { provider: 'ollama', model: 'm', baseURL: 'http://b/api' },
  ] as const

  it('další dávka dostane k vyhnutí i otázky z dávek hotových v tomtéž běhu', async () => {
    const prompty: string[] = []
    let poradi = 0
    const call: ModelCall = async ({ prompt }) => {
      prompty.push(prompt)
      return { questions: Array.from({ length: 5 }, () => otazka(++poradi)) }
    }
    await generateQuestions({ ...ZADANI, count: 15 }, { workers: [...WORKERI], callModel: call })
    expect(prompty).toHaveLength(3)
    expect(prompty[2]).toContain('Otázka číslo 1?')
  })

  it('stejné zadání lišící se jen velikostí písmen a interpunkcí uloží jen jednou', async () => {
    const zneni = ['Co je výpar?', 'co je výpar', 'Co je  výpar ?']
    let i = 0
    const call: ModelCall = async () => ({
      questions: [{ ...otazka(0), payload: { prompt: zneni[i++ % 3]!, answer: 'odpověď', acceptedAnswers: [] } }],
    })
    const vysledek = await generateQuestions({ ...ZADANI, count: 15 }, { workers: [...WORKERI], callModel: call })
    expect(vysledek.questions).toHaveLength(1)
  })
})
```

- [ ] **Krok 2: Ověřit, že testy padají**

Spustit: `cd packages/core && pnpm exec vitest run test/ai-ladder.test.ts -t "paralelní workeři"`
Očekávat: FAIL — třetí prompt neobsahuje „Otázka číslo 1?"; uloží se víc variant „výpar".

- [ ] **Krok 3: Implementace**

V `packages/core/src/ai/generate.ts` vedle `promptOf`:

```ts
/**
 * Klíč pro rozpoznání téže otázky: bez velikosti písmen, interpunkce
 * a rozdílů v mezerách. Model tutéž otázku často vrátí jen s jinou tečkou
 * nebo velkým písmenem.
 */
export function dedupeKey(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
```

V cestě s workery, ve smyčce `while (true)`, sestavovat prompt s dosud hotovými zadáními (nahradit řádek `avoid: request.avoid,`):

```ts
            // Hotové dávky z tohoto běhu jdou první, ať se je další dávky
            // neptají znovu — workeři běží souběžně nad týmiž úseky.
            avoid: [...results.flatMap((r) => r.questions.map(promptOf)), ...(request.avoid ?? [])],
```

a množinu viděných zadání vést přes klíč (nahradit `const seenPrompts = new Set(request.avoid ?? [])` a dva řádky s `promptKey`):

```ts
    const seenPrompts = new Set((request.avoid ?? []).map(dedupeKey))
```

```ts
        const promptKey = dedupeKey(promptOf(normalized))
        if (seenPrompts.has(promptKey)) continue
        seenPrompts.add(promptKey)
```

V sekvenční cestě přidat stejnou deduplikaci: před smyčkou `for (const [index, chunk] of chunks.entries())` založit

```ts
  const seenSequential = new Set((request.avoid ?? []).map(dedupeKey))
```

a ve smyčce přes `produced` místo `batch.push(withDefaultPoints(normalizeOrderingPayload(question)))`:

```ts
        const normalized = withDefaultPoints(normalizeOrderingPayload(question))
        const key = dedupeKey(promptOf(normalized))
        if (seenSequential.has(key)) continue
        seenSequential.add(key)
        batch.push(normalized)
```

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS. Kdyby padal existující test žebříčku kvůli tomu, že podvržený model vrací v různých dávkách stejná zadání, je to očekávaný důsledek deduplikace — upravit podvržený model, aby číslo otázky rostlo (jako `podvrzenyModel`), ne vracet deduplikaci.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ai/generate.ts packages/core/test/ai-ladder.test.ts
git commit -m "fix(ai): stop parallel workers from asking the same question twice

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 6: Kratší systémový prompt

**Soubory:**
- Upravit: `packages/core/src/ai/prompt.ts` (`buildSystemPrompt`, položky `TYPE_HINTS` pro tři AI typy)
- Test: `packages/core/test/ai.test.ts`

**Rozhraní:**
- `buildSystemPrompt(gradeName?: string | null): string` — beze změny signatury.
- Existující testy hlídají, že prompt obsahuje: `výhradně z dodaného materiálu`, `Otázka musí být samostatná`, `podle materiálu`, `uvedeno výše`, `evidence`, `vysoké školy`, `odborností materiálu`, `základní škol`, u 8. ročníku `13–14 let`. Nový prompt je musí zachovat.

- [ ] **Krok 1: Napsat padající test**

Do bloku `describe('prompty', …)` v `ai.test.ts`:

```ts
  it('systémový prompt je krátký, aby ho malý model udržel', () => {
    const prompt = buildSystemPrompt('6. ročník')
    expect(prompt.length).toBeLessThan(1600)
    expect(prompt).toContain('doslova')
  })
```

- [ ] **Krok 2: Ověřit, že test padá**

Spustit: `cd packages/core && pnpm exec vitest run test/ai.test.ts -t "krátký"`
Očekávat: FAIL — prompt má přes 3 000 znaků.

- [ ] **Krok 3: Implementace**

V `packages/core/src/ai/prompt.ts` nahradit tělo `buildSystemPrompt`:

```ts
export function buildSystemPrompt(gradeName?: string | null): string {
  const audience = describeGradeAudience(gradeName)
  // Pravidel je schválně málo: malý model dlouhý seznam neudrží a z posledních
  // bodů si nepamatuje nic. Co jde zkontrolovat v kódu (tvar, indexy, citace),
  // se kontroluje v kódu, ne promptem.
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

a v `TYPE_HINTS` zkrátit tři AI typy (ostatní položky ponechat — `Record` je musí obsahovat):

```ts
  short_answer: 'Odpověď je jedno slovo nebo krátké sousloví z materiálu. Do `acceptedAnswers` dej běžné varianty.',
  single_choice: 'Čtyři možnosti, právě jedna správná. `correctIndex` je pořadí správné možnosti od nuly.',
  true_false: '4 krátká tvrzení, zhruba půl pravdivých. Nepravdivé tvrzení vznikne malou změnou pravdivého.',
```

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS včetně všech starších testů promptu.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ai/prompt.ts packages/core/test/ai.test.ts
git commit -m "fix(ai): cut the system prompt to rules a small model can hold

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 7: Zkušební generování do Markdownu (srovnávací základ)

**Soubory:**
- Vytvořit: `apps/web/scripts/zkouska-generovani.ts`
- Upravit: `apps/web/package.json` (skript `generate:try`)

**Rozhraní:**
- Konzumuje: `generateQuestions`, `readOllamaWorkers`, `readAiLadder` z `@testmaker/core/ai`; `QuestionContent` z `@testmaker/core/schema`.
- Nesahá na databázi. Vstupem je textový soubor, výstupem `<vstup>.otazky.md` vedle něj.

- [ ] **Krok 1: Skript**

`apps/web/scripts/zkouska-generovani.ts`:

```ts
/**
 * Zkušební generování bez databáze: vezme textový soubor s materiálem,
 * vygeneruje otázky modelem z .env.local a zapíše je do Markdownu
 * k ručnímu hodnocení (dobrá / špatná). Slouží jako srovnávací základ před
 * změnou generování a po ní a pro porovnání modelů.
 *
 *   pnpm --filter @testmaker/web generate:try <soubor.txt> "<ročník>" "<předmět>" "<téma>" [počet]
 *
 * Materiál ulož jako .txt se záhlavím `=== název souboru ===` na prvním řádku.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { generateQuestions, readAiLadder, readOllamaWorkers } from '@testmaker/core/ai'
import type { QuestionContent } from '@testmaker/core/schema'

function popis(q: QuestionContent): string {
  switch (q.type) {
    case 'single_choice':
      return [
        q.payload.prompt,
        ...q.payload.options.map((o, i) => `   ${i === q.payload.correctIndex ? '**✓**' : '·'} ${o}`),
      ].join('\n')
    case 'true_false':
      return [
        q.payload.prompt,
        ...q.payload.statements.map((s) => `   ${s.isTrue ? 'P' : 'N'} — ${s.text}`),
      ].join('\n')
    case 'short_answer':
      return `${q.payload.prompt}\n   Odpověď: **${q.payload.answer}**${
        q.payload.acceptedAnswers.length ? ` (také: ${q.payload.acceptedAnswers.join(', ')})` : ''
      }`
    default:
      return `\`\`\`json\n${JSON.stringify(q.payload, null, 2)}\n\`\`\``
  }
}

async function main() {
  const [soubor, rocnik, predmet, tema, pocet] = process.argv.slice(2)
  if (!soubor || !rocnik || !predmet || !tema) {
    console.error('Použití: generate:try <soubor.txt> "<ročník>" "<předmět>" "<téma>" [počet]')
    process.exit(1)
  }
  const text = await readFile(soubor, 'utf8')
  const workers = readOllamaWorkers()
  const start = Date.now()
  const vysledek = await generateQuestions(
    {
      text,
      topicName: tema,
      subjectName: predmet,
      gradeName: rocnik,
      count: Number(pocet) || 10,
      types: ['single_choice', 'true_false', 'short_answer'],
      difficulty: 'mix',
    },
    workers.length > 0 ? { workers } : { configs: readAiLadder() },
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
  const vystup = soubor.replace(/\.[^.]+$/, '') + '.otazky.md'
  await writeFile(vystup, radky.join('\n'))
  console.log(`Zapsáno: ${vystup}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Krok 2: Skript do `package.json`**

V `apps/web/package.json` do `"scripts"` za `"generate:bulk"`:

```json
    "generate:try": "tsx --env-file=.env.local scripts/zkouska-generovani.ts",
```

- [ ] **Krok 3: Ověřit typy**

Spustit: `pnpm typecheck`
Očekávat: bez chyb. (Pokud `apps/web/tsconfig.json` nezahrnuje `scripts/`, spustit `cd apps/web && pnpm exec tsc --noEmit --skipLibCheck scripts/zkouska-generovani.ts` není nutné — stačí, že skript jde spustit v kroku 5.)

- [ ] **Krok 4: Commit**

```bash
git add apps/web/scripts/zkouska-generovani.ts apps/web/package.json
git commit -m "feat(ai): add a dry-run script to rate generated questions by hand

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Krok 5: Ruční ověření s majitelem (ne automaticky)**

Tohle dělá majitel, protože sahá na worker v jeho síti a na skutečný materiál:

1. Na workeru ověřit kontext: `curl -s http://192.168.20.105:11434/api/ps` během generování — `context_length` má být 16384.
2. Uložit jeden kratší materiál (1–2 strany) jako `.txt` se záhlavím `=== název ===` mimo repozitář.
3. Spustit `pnpm --filter @testmaker/web generate:try ~/zkouska/houby.txt "6. ročník" "Přírodopis" "Houby" 10`.
4. Učitelka zaškrtá v `houby.otazky.md` dobré otázky.
5. Srovnání se stavem před změnou: `git worktree add ../tm-pred 6b7e576`, do `../tm-pred/apps/web/scripts/` zkopírovat `zkouska-generovani.ts`, do jeho `package.json` přidat řádek `generate:try`, zkopírovat `.env.local`, `pnpm install` a spustit týž příkaz s jiným názvem výstupu (zkopírovat `.txt` pod jiným jménem). Signatura `generateQuestions` je na obou commitech stejná.
6. Srovnání modelů: týž příkaz s `OLLAMA_WORKERS=http://192.168.20.105:11434/api|gemma3:27b` (model musí být na workeru stažený).

---

## Po dokončení

- Hotové generování: `pnpm test`, `pnpm typecheck`, `pnpm build` v kořeni.
- Mimo tento plán, ale stojí za zvážení: `puzzleWords.ts` volá `generateObject` bez `providerOptions` — až majitel dokončí své rozpracované změny v tomto souboru, přidat tam `providerOptions: providerOptionsFor(config)` stejně jako v úkolu 1.
