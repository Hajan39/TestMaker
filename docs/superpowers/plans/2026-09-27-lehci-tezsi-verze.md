# Lehčí a těžší verze otázek a písemky — plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cíl:** Učitelka si k otázce nechá vytvořit lehčí nebo těžší verzi (nová otázka ze stejné pasáže, původní zůstává, obě jsou propojené) a z hotové písemky jedním tlačítkem vytvoří její lehčí nebo těžší kopii.

**Architektura:** Otázka dostane nepovinný odkaz `variant_of` na původní otázku (migrace 0019, drizzle-kit se snímkem). Verze vzniká stejnou cestou jako náhrada při přegenerování (`generateQuestions` s `focus` na citaci původní otázky, stejný typ, obtížnost ±1, v zadání věta „Vytvoř lehčí/těžší verzi této otázky: …"), jen původní otázka se neruší a nepíše se zpětná vazba. Verze písemky je kopie testu (`copyTest`), ve které se každá otázková položka vymění za existující verzi požadované obtížnosti, nebo se verze dogeneruje; průběh se streamuje jako u generování (NDJSON).

**Tech stack:** Next.js App Router, Drizzle (libsql), zod, AI SDK v `packages/core`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-zjednoduseni-ucitelka-design.md` — „Přegenerování s důvodem" (poslední odrážka), pořadí prací krok 7; rozhodnutí majitele 2026-09-27: verze otázky na kartě i verze celé písemky.

## Globální omezení

- Česky; commity anglicky se `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Nikdy `apps/web/local.db` ani port 3000; Playwright jen přes jeho konfigurace; migrace nad ostrou DB nespouštět; po změně schématu `pnpm db:generate` hlásí „No schema changes".
- Každý dotaz přes `Scope`; cizí otázka/test → 404; zápis jen role s právem zápisu; verze písemky vzniká jako nový test vlastněný tím, kdo ji vytvořil (pravidla `copyTest`).
- Testy nevolají skutečný model.
- Tokeny, mobil 360 px; role `nahled` nevidí tlačítka verzí.

## Na co si dát pozor při revizi

1. **Lehčí verze otázky s obtížností 1 / těžší s 3** — tlačítko je vypnuté s vysvětlením; API vrátí 400 s českou hláškou. Test v úkolu 1.
2. **Verze verze** — lehčí verze těžší verze se naváže na *původní* otázku (kořen), ne do řetězu; na kartě se ukazují všechny verze kořene. Test v úkolu 1.
3. **Smazaná (rejected) verze** se při skládání verze písemky nepoužije; vygeneruje se nová. Test v úkolu 3.
4. **Položka písemky bez otázky v bance** (otázka smazaná natvrdo, `questionId` null) nebo hlavolam — zůstane beze změny. Test v úkolu 3.
5. **Model selže uprostřed verze písemky** — vzniklá kopie zůstane s tím, co se stihlo, a hlášení řekne, kolik otázek zůstalo původních. Test v úkolu 3.

---

### Úkol 1: Verze otázky v datech a API

**Soubory:** `apps/web/src/db/schema.ts` (`questions.variantOf` text, FK na `questions.id` `on delete set null`), migrace `0019_question-variant.sql` + snímek, `apps/web/src/lib/generation.ts` (`createVariant(scope, questionId, direction: 'easier' | 'harder', options?: { signal?; generate? })`), `packages/core/src/ai/prompts/questions.ts` (sekce zadání pro verzi — využít/rozšířit `replacementReason` nebo nové `variantOf: { direction; originalPrompt }`), nová routa `apps/web/src/app/api/questions/variant/route.ts` (`POST { id, direction }` → `{ question }`), `apps/web/src/lib/questions.ts` (načítání vazeb: `loadVariantLinks(scope, questionIds)` → `Record<rootId, { id; difficulty; status }[]>` nebo pole `variantOf` v `Question`), testy `apps/web/test/variant.test.ts`, `packages/core/test/ai.test.ts`.

Chování: kořen = `original.variantOf ?? original.id`; nová otázka má `variantOf = kořen`, stejný `topicId`, typ, `source: 'ai'`, `status: 'approved'`, obtížnost `original.difficulty ± 1` (mimo 1–3 → 400 „Otázka je už nejlehčí/nejtěžší."); zadání modelu obsahuje původní zadání a pokyn k lehčí/těžší variantě na stejnou látku (ne tutéž otázku jinými slovy); stejné kontroly jako generování (`checkQuestion`, duplicita vůči tématu). Zaneprázdněné téma → 409 jako u přegenerování. Model se uloží do `questions.model`.

- [ ] Testy (padají): verze vznikne s posunutou obtížností a `variantOf = kořen`; verze verze se naváže na kořen; hranice obtížnosti → 400; cizí otázka → 404; `nahled` → 403; neplatný směr → 400; zadání pro model obsahuje původní otázku a směr (core test).
- [ ] Implementace + migrace; `pnpm db:generate` bez změn; `pnpm test && pnpm typecheck`.
- [ ] Commit: `feat(questions): make an easier or harder version of a question`.

---

### Úkol 2: Verze na kartě otázky

**Soubory:** `apps/web/src/components/QuestionCard.tsx`, `apps/web/src/components/TopicQuestions.tsx`, `apps/web/src/app/topics/[id]/page.tsx` + `TopicWorkspace.tsx` (předání vazeb verzí), nový `apps/web/src/components/useQuestionVariant.ts`, e2e `apps/web/e2e/verze.spec.ts` (nový; `page.route` na `/api/questions/variant`).

Chování: v menu u „Přegenerovat" (nebo vedle) položky „Lehčí verze" a „Těžší verze" (vypnuté s nápovědou na hranici obtížnosti); po vytvoření toast „Vznikla lehčí verze otázky." a nová karta se objeví (router.refresh) a posune do zorného pole. Karta, která má verze (nebo sama je verzí), ukazuje drobný řádek „Verze: lehčí · těžší" s odkazy, které na příslušnou kartu posunou a krátce ji zvýrazní. Filtry a výběr do testu fungují s verzemi jako s ostatními otázkami. Role `nahled` nevidí položky vytváření, řádek verzí ano.

- [ ] e2e (padá): „Lehčí verze" pošle `{ id, direction: 'easier' }` a nová karta se objeví; u obtížnosti 1 je „Lehčí verze" vypnutá; řádek verzí vede na kartu verze; nahled (login `role.spec.ts`) nevidí tvorbu verzí.
- [ ] Implementace; `pnpm test && pnpm typecheck && pnpm build`; `playwright test e2e/verze.spec.ts e2e/tema-otazky.spec.ts e2e/pregenerovani.spec.ts` + login `role.spec.ts`.
- [ ] Commit: `feat(web): create and follow easier or harder versions from the question card`.

---

### Úkol 3: Lehčí / těžší verze písemky

**Soubory:** nová routa `apps/web/src/app/api/tests/variant/route.ts` (`POST { testId, direction }`, odpověď NDJSON: `start { total }`, `progress { done, total }`, `done { testId, replaced, generated, kept }`, `error { message }`), `apps/web/src/lib/testVariant.ts` (nový: `createTestVariant(scope, testId, direction, { onProgress, signal, generate? })`, využije `copyTest` logiku z `apps/web/src/app/api/tests/route.ts` — přesunout ji do lib, pokud je v routě — a `createVariant` z úkolu 1), UI v editoru `apps/web/src/components/TestBuilder.tsx` (tlačítka „Lehčí verze písemky" / „Těžší verze písemky" v hlavičce nebo v menu, dialog s průběhem, po dokončení otevřít nový test), klientský stream (vzor `apps/web/src/lib/generateClient.ts`), testy `apps/web/test/test-variant.test.ts`, e2e `apps/web/e2e/verze.spec.ts`.

Chování: nový test = kopie (název „<název> – lehčí" / „– těžší", stejná šablona, hlavička, třída `gradeId`, vlastník = volající, soukromý); pro každou otázkovou položku v pořadí: najdi mezi verzemi kořene otázku s obtížností `původní ± 1`, `status` ne `rejected` → použij; jinak `createVariant`; na hranici obtížnosti ponech původní (`kept`); položky bez `questionId` a hlavolamy beze změny. Snímky položek (`questionSnapshot`) se sestaví z nových otázek (stejně jako při uložení testu). Selhání modelu u jedné položky → položka zůstane původní, pokračuje se, v `done` je počet ponechaných; neopravitelná chyba (žádný model) → `error` a nic nevznikne (test se vytvoří až po první úspěšné fázi, nebo se při chybě smaže — zvolit jednodušší a konzistentní). Neuložené změny v editoru: tlačítko vytvoří verzi z *uložené* podoby testu; když jsou změny neuložené, nejdřív vyzve k uložení.

- [ ] Testy (padají): verze písemky použije existující verze a chybějící dogeneruje (podvržené generování); hranice obtížnosti → ponecháno; hlavolam a položka bez otázky beze změny; rejected verze se nepoužije; selhání modelu u jedné otázky → ponecháno a pokračuje se; cizí test → 404; nahled → 403; nový test má `gradeId` a správný název; e2e: tlačítko s podvrženým streamem otevře nový test.
- [ ] Implementace; `pnpm test && pnpm typecheck && pnpm build`; `playwright test e2e/verze.spec.ts e2e/testy.spec.ts e2e/osnova.spec.ts e2e/tema-vyber-testu.spec.ts`.
- [ ] Commit: `feat(tests): make an easier or harder copy of a test in one click`.

---

### Úkol 4: Dokumentace

**Soubory:** `CHANGELOG.md` (Nevydáno: verze otázek a písemky; AI generuje i přiřazování, řazení a doplňování), `README.md` (krátce), spec (krok 7 hotový, popis chování).

- [ ] Úpravy; commit `docs: describe question and test versions`.

---

## Po dokončení

Celá sada (výchozí i login Playwright na čerstvé `e2e.db`), `pnpm test`, `pnpm typecheck`, `pnpm build`. Majitel spustí migraci 0019 (`cd apps/web && pnpm db:migrate`).
