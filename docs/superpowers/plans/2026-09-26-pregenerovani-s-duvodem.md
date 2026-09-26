# Přegenerování s důvodem — plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cíl:** Učitelka může u „Přegenerovat" nepovinně říct, co bylo špatně; náhrada to zohlední, důvod se uloží s modelem, správce vidí přehled chyb podle modelu a předmětu a nejčastější chybu může jedním klikem povýšit na trvalé pravidlo promptu své školy.

**Architektura:** Důvody jsou konstanta ve schématu (`REGENERATE_REASONS`: klíč, popisek, věta do zadání, posun obtížnosti). Zpětná vazba je samostatná tabulka `question_feedback` (vzor `generation_jobs`/`audit_log`): nahrazená otázka, náhrada, model, důvod, poznámka, kdo, kdy. Důvod jde do `GenerationRequest.replacementReason` → nová sekce `buildUserPrompt`; „moc těžká/lehká" posune obtížnost náhrady. Přehled „AI kvalita" je nová záložka Správy nad agregačními dotazy (vzor `countJobs`). Pravidla školy jsou tabulka `prompt_rules`; aktivní pravidla se načtou při generování a `buildSystemPrompt` je připojí jako „Pravidla této školy".

**Tech stack:** Next.js App Router, Drizzle (libsql), zod, AI SDK v `packages/core`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-zjednoduseni-ucitelka-design.md` — „Přegenerování s důvodem", pořadí prací krok 6. Předpoklad: krok 5 hotový (stránka `/review` a `ReviewScreen` už neexistují — přegenerování žije jen na kartě v tématu a v menu banky, pokud banka v kroku 5 zůstala).

## Globální omezení

- Česky kód/komentáře/texty; commity anglicky zakončené `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Nikdy `apps/web/local.db` ani port 3000; Playwright jen přes jeho konfigurace; migrace nad ostrou DB nespouštět; po změně schématu `pnpm db:generate` hlásí „No schema changes".
- Každý dotaz přes `Scope` (`skola()`); přehled a pravidla jen pro roli `spravce`; cizí data se neprozradí.
- Testy nevolají skutečný model (podvržené `generate`/`callModel`).
- Přegenerování bez důvodu funguje jedním klikem jako dnes.
- Nic se do promptu nepřidává automaticky — pravidlo vzniká jen výslovným uložením správcem.
- Tokeny, mobil 360 px, do commitů jen vyjmenované soubory.

## Na co si dát pozor při revizi

1. **Přegenerování bez důvodu** — chování a počet kliknutí beze změny; záznam zpětné vazby vznikne i tak (s `reason: null`), aby šel spočítat podíl přegenerovaných otázek podle modelu. Test v úkolu 1.
2. **„Moc lehká" u obtížnosti 3 / „Moc těžká" u 1** — obtížnost se nepřehoupne mimo 1–3. Test v úkolu 1.
3. **Poznámka s nebezpečným obsahem** (dlouhá, uvozovky, „ignoruj pravidla") — ořízne se (max 300 znaků) a vloží jako citace, ne jako instrukce. Test v úkolu 1.
4. **Model neznámý** (starší otázky bez `model`) — v přehledu jako „neznámý model", nespadne. Test v úkolu 3.
5. **Vypnuté pravidlo** se do promptu nedostane; pravidla jiné školy nikdy. Test v úkolu 4.

---

### Úkol 1: Důvod v datech a v zadání náhrady

**Soubory:** `packages/core/src/schema/question.ts` (`REGENERATE_REASONS`), `packages/core/src/ai/prompts/questions.ts` (`GenerationRequest.replacementReason`, sekce v `buildUserPrompt`), `apps/web/src/db/schema.ts` (`questionFeedback`), migrace `0017_question-feedback.sql` + snímek, `apps/web/src/lib/generation.ts` (`regenerateQuestion(scope, id, { reason?, note?, signal? })`), `apps/web/src/app/api/questions/regenerate/route.ts` (tělo `{ id, reason?, note? }`), testy `apps/web/test/regenerate.test.ts`, `packages/core/test/ai.test.ts`.

**Rozhraní:**
```ts
export const REGENERATE_REASONS = {
  nesmysl: { label: 'Nedává smysl', hint: 'Předchozí verze nedávala smysl — zadání musí být jasné a jednoznačné.', shift: 0 },
  moznosti: { label: 'Špatné možnosti', hint: 'Předchozí verze měla špatné možnosti — právě jedna musí být správná a ostatní věrohodně špatné.', shift: 0 },
  mimo: { label: 'Odpověď v materiálu není', hint: 'Předchozí verze se ptala na něco, co v materiálu není — drž se doslova textu.', shift: 0 },
  tezka: { label: 'Moc těžká', hint: 'Předchozí verze byla na ročník moc těžká.', shift: -1 },
  lehka: { label: 'Moc lehká', hint: 'Předchozí verze byla moc lehká.', shift: 1 },
  cestina: { label: 'Špatná čeština', hint: 'Předchozí verze měla chyby v češtině — piš spisovně a jednoduše.', shift: 0 },
} as const
export type RegenerateReason = keyof typeof REGENERATE_REASONS
```
- `questionFeedback`: `id, schoolId, questionId (nahrazená, FK set null), replacementId (FK set null), model (text, model nahrazené otázky), reason (text nullable), note (text nullable), createdBy (FK users), createdAt`.
- `GenerationRequest.replacementReason?: { hint: string; note?: string }` → v `buildUserPrompt` sekce „Proč se otázka nahrazuje: …" + poznámka učitelky jako citace v uvozovkách (max 300 znaků).
- `regenerateQuestion`: obtížnost náhrady = `clamp(original.difficulty + shift, 1, 3)`; po úspěšné náhradě zapíše řádek `questionFeedback` (i bez důvodu).

- [ ] Testy (padají): důvod se objeví v promptu (core); poznámka oříznutá a v uvozovkách; posun obtížnosti s ořezem 1–3; záznam zpětné vazby s modelem nahrazené otázky; bez důvodu záznam s `reason: null`; neplatný důvod v API → 400; nahled → 403.
- [ ] Implementace + migrace; `pnpm db:generate` bez změn; `pnpm test && pnpm typecheck`.
- [ ] Commit: `feat(questions): regenerate with an optional reason and keep it`.

---

### Úkol 2: Výběr důvodu v rozhraní

**Soubory:** `apps/web/src/components/useRegenerateQuestion.ts` (`run(reason?, note?)`), `apps/web/src/components/RegenerateButton.tsx` (rozdělené tlačítko: hlavní část „Přegenerovat" hned; šipka otevře nabídku důvodů), `apps/web/src/app/questions/QuestionActions.tsx` (podnabídka „Přegenerovat s důvodem", pokud banka po kroku 5 existuje), e2e `apps/web/e2e/pregenerovani.spec.ts` (nový; model podvržený jako v `prubeh-generovani.spec.ts` nebo přes route interception odpovědi `/api/questions/regenerate`).

Chování: nabídka (`DropdownMenu`/`Popover` z `@testmaker/ui`) s šesti štítky a polem „Poznámka (nepovinná)"; volba štítku → hned přegeneruje s důvodem (poznámku lze vyplnit před klikem na štítek); toast „Otázka nahrazena novou." jako dnes. Role `nahled` nic z toho nevidí.

- [ ] e2e (padá): hlavní tlačítko přegeneruje bez důvodu (tělo požadavku bez `reason`); nabídka → „Špatné možnosti" s poznámkou → tělo obsahuje `reason: 'moznosti'` a poznámku; na mobilu 360 px je nabídka celá vidět.
- [ ] Implementace; `pnpm test && pnpm typecheck && pnpm build`; `playwright test e2e/pregenerovani.spec.ts e2e/tema-otazky.spec.ts` (+ `banka.spec.ts`, pokud banka existuje).
- [ ] Commit: `feat(web): tell the model why a question is being replaced`.

---

### Úkol 3: Přehled „AI kvalita" ve Správě

**Soubory:** `apps/web/src/lib/aiQuality.ts` (nový), `apps/web/src/app/sprava/page.tsx`, `apps/web/src/app/sprava/SpravaScreen.tsx` (nová záložka), testy `apps/web/test/ai-quality.test.ts`, e2e `apps/web/e2e/sprava.spec.ts` (login config, správce).

**Rozhraní:** `loadAiQuality(scope, { since?: string }): Promise<{ models: { model: string; generated: number; regenerated: number }[]; reasons: { reason: RegenerateReason | null; count: number }[]; bySubject: { subject: string; regenerated: number; topReason: RegenerateReason | null }[] }>` — `generated` = počet AI otázek s tím modelem (`questions.source = 'ai'`), `regenerated` = počet řádků `questionFeedback` s tím modelem; výchozí období posledních 90 dní.

Chování: záložka „AI kvalita": tabulka modelů (vygenerováno, přegenerováno, podíl %), nejčastější důvody (s popisky z `REGENERATE_REASONS`, „bez udání důvodu"), předměty s nejvíc přegenerováním. Prázdný stav „Zatím žádná zpětná vazba.".

- [ ] Testy (padají): agregace podle modelu a důvodu; otázky jiné školy se nezapočítají; starší otázky bez modelu jako „neznámý model"; e2e: správce vidí záložku s čísly, učitelka ne.
- [ ] Implementace; `pnpm test && pnpm typecheck && pnpm build`; login `sprava.spec.ts`.
- [ ] Commit: `feat(sprava): show which models get their questions regenerated and why`.

---

### Úkol 4: Pravidla promptu školy

**Soubory:** `apps/web/src/db/schema.ts` (`promptRules`), migrace `0018_prompt-rules.sql` + snímek, `apps/web/src/lib/promptRules.ts` (nový: `loadActivePromptRules(scope)`, `createPromptRule`, `setPromptRuleActive`), API `apps/web/src/app/api/prompt-rules/route.ts` (GET/POST/PATCH, jen `spravce`), `packages/core/src/ai/prompts/questions.ts` (`buildSystemPrompt(gradeName, schoolRules?: string[])`), `packages/core/src/ai/generate.ts` (předat `request.schoolRules`), `apps/web/src/lib/generation.ts` (`generateForTopic` i `regenerateQuestion` načtou aktivní pravidla a pošlou je), `apps/web/src/lib/questionFile.ts` (`/otazky` pravidla: `buildQuestionRules` dostane pravidla školy — skript `otazky:pravidla` je bez DB, proto jen API/stažený soubor: pravidla přidat do hlavičky staženého zdroje), `SpravaScreen.tsx` (v záložce „AI kvalita" u každého důvodu „Udělat z toho pravidlo" → předvyplněný text z `hint`, úprava, uložit; seznam pravidel s přepínačem aktivní), testy.

**Rozhraní:** `promptRules`: `id, schoolId, text (max 300), reason (nullable), active (boolean default true), createdBy, createdAt`. `buildSystemPrompt` připojí sekci „Pravidla této školy:" s odrážkami, jen když je seznam neprázdný. Délka systémového promptu s pravidly: test délky z kroku kvality (< 1600) platí jen bez pravidel; s pravidly nejvýš +10 pravidel.

- [ ] Testy (padají): aktivní pravidlo je v systémovém promptu, vypnuté ne, pravidlo jiné školy nikdy (bod revize 5); nejvýš 10 aktivních pravidel (11. → 400 s českou hláškou); učitelka → 403; e2e: správce z důvodu vytvoří pravidlo, vypne ho.
- [ ] Implementace + migrace; `pnpm db:generate` bez změn; `pnpm test && pnpm typecheck && pnpm build`; login `sprava.spec.ts`.
- [ ] Commit: `feat(ai): let the admin turn a frequent problem into a school prompt rule`.

---

## Po dokončení

- Celá sada (výchozí i login Playwright na čerstvé `e2e.db`), `pnpm test`, `pnpm typecheck`, `pnpm build`.
- Majitel spustí migrace 0017–0018 (`cd apps/web && pnpm db:migrate`).
