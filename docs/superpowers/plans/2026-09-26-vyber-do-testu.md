# Výběr otázek do testu z tématu — plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cíl:** Učitelka v tématu zaškrtá otázky a jedním tlačítkem z nich vytvoří test; vidí, které otázky už v nějakém testu jsou; v editoru testu přidává otázky nejdřív z témat téže třídy, a přehled testů jde filtrovat podle třídy.

**Architektura:** Test dostane nepovinný odkaz na ročník (`tests.grade_id`, migrace 0015 generovaná drizzle-kit). Vytvoření testu z tématu je klientské `POST /api/tests` (stejné API jako editor) s položkami typu `question` a `gradeId`, po uložení přesměrování do editoru. Použití otázek v testech zjišťuje nová funkce `loadTestUsageForQuestions` nad `test_items ⋈ tests` s `viditelnyTest`. Editor a přehled testů pracují s `gradeId` místo textového názvu ročníku.

**Tech stack:** Next.js App Router, React, Drizzle (libsql), zod, vitest, Playwright, shadcn/ui v `packages/ui`.

**Spec:** `docs/superpowers/specs/2026-09-25-zjednoduseni-ucitelka-design.md` — kapitoly „Stránka tématu → Výběr do testu", „Editor testu a víc témat", „Změny v datech → tests.grade_id", pořadí prací krok 3. Z kroku 2 sem patří i filtr „ještě nepoužité v testu" (rozhodnutí v předchozím plánu).

## Globální omezení

- Kód, komentáře, texty česky; commity anglicky podle Conventional Commits, zakončené řádkem `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Nikdy nesahat na `apps/web/local.db` ani na server na portu 3000 (majitelova aplikace). Prohlížečové testy jen přes Playwright (port 3100, `e2e.db`; přihlášení `-c playwright.login.config.ts`, port 3101). Migraci nad `local.db` nespouštět.
- Každá funkce v `apps/web/src/lib/*` bere `Scope`. Cizí věc se tváří jako neexistující (`null`/404). Test čte `viditelnyTest`, zapisuje `vlastni`. `gradeId` z požadavku se před uložením ověří proti škole (`skola(scope, grades)`); cizí nebo neexistující ročník se tiše uloží jako `null` — z odpovědi nesmí být poznat, že existuje.
- Barvy jen tokeny z `packages/ui/src/styles.css`, mobil šířky 360 px bez vodorovného posunu.
- Role `nahled` nevidí zaškrtávátka ani lištu výběru.
- Do commitů jen vyjmenované soubory (`git add <soubor>`), nikdy `git add -A`.
- Ověření po každém úkolu: `pnpm test`, `pnpm typecheck`; u úkolů s rozhraním i `pnpm build` a příslušné Playwright specy.

## Na co si dát pozor při revizi

1. **Otázka v testu, který učitelka nevidí** (cizí soukromý test kolegyně) — štítek „v testu" ho nesmí prozradit. Test v úkolu 2.
2. **Zaškrtnutá otázka se mezitím smaže** (jinou kartou nebo „Smazat" na ní) — z výběru i součtu bodů zmizí. Test v úkolu 3.
3. **Test vytvořený z tématu se zkopíruje** (`copyOf`) — kopie si ročník ponechá. Test v úkolu 1.
4. **Ročník se smaže** (`on delete set null`) — test zůstane a editor ani přehled nespadnou. Test v úkolu 1.
5. **Starý test bez ročníku** — editor nabídne všechna témata jako dřív, přehled ho ukáže ve filtru „Všechny třídy". Test v úkolu 4.

---

### Úkol 1: `tests.grade_id`

**Soubory:**
- Upravit: `apps/web/src/db/schema.ts` (tabulka `tests`)
- Vytvořit (drizzle-kit): `apps/web/drizzle/0015_*.sql` + snapshot + záznam v `meta/_journal.json`
- Upravit: `apps/web/src/app/api/tests/route.ts` (`testSchema`, POST, PUT, `copyTest`), `apps/web/src/lib/tests.ts` (`loadTest` vrací `gradeId`), typ `Test` v `packages/core/src/schema/test.ts`, pokud tam je
- Test: `apps/web/test/tests-api.test.ts`, `apps/web/test/tests-copy.test.ts`

**Rozhraní:**
- `tests.gradeId: text('grade_id').references(() => grades.id, { onDelete: 'set null' })` (nepovinný).
- `testSchema` přijímá `gradeId: z.string().min(1).nullable().default(null)`.
- `loadTest(scope, id)` vrací i `gradeId: string | null`.

- [ ] **Krok 1: Testy (padají)** — v `tests-api.test.ts`: POST s `gradeId` ročníku téže školy → uloženo; POST s `gradeId` cizí školy nebo neexistujícím → uloženo `null` a odpověď 200 (nic neprozradí); PUT zachová/změní `gradeId`; smazání ročníku (`db.delete(grades)`) → test existuje s `gradeId === null`. V `tests-copy.test.ts`: kopie si `gradeId` ponechá. Pro ročník jiné školy použít vzor z testů rozsahu (`apps/web/test/rozsah.test.ts`).
- [ ] **Krok 2: Ověřit, že padají** — `cd apps/web && pnpm exec vitest run test/tests-api.test.ts test/tests-copy.test.ts`.
- [ ] **Krok 3: Schéma a migrace** — přidat sloupec do `tests` (komentář česky: třída, ze které test vznikl; řídí nabídku témat v editoru a filtr přehledu), pak `cd apps/web && pnpm db:generate` → vznikne `0015_…sql` (přejmenovat na `0015_test-grade.sql` včetně tagu v `_journal.json`, pokud drizzle-kit dá náhodné jméno). Obsah zkontrolovat: jen `ALTER TABLE tests ADD grade_id … REFERENCES grades(id) ON DELETE set null` (SQLite přidání sloupce s FK — pokud drizzle-kit vygeneruje přestavbu tabulky, ověřit, že kopíruje všechna data; migrace musí být bezpečná nad ostrou DB).
- [ ] **Krok 4: API a lib** — ověření ročníku: pomocná funkce v `lib/tests.ts` `resolveGradeId(scope, gradeId: string | null): Promise<string | null>` (vrací id jen pokud `grades` řádek patří škole scope). Použít v POST i PUT; `copyTest` kopíruje `gradeId`. `loadTest` vrací `gradeId`.
- [ ] **Krok 5: Ověřit** — `pnpm test && pnpm typecheck`; `cd apps/web && pnpm exec playwright test e2e/testy.spec.ts e2e/osnova.spec.ts` (e2e databáze se musí přestavět, pokud vzniká migracemi — `rm apps/web/e2e.db apps/web/e2e-login.db` je bezpečné, jsou jednorázové a v gitignore).
- [ ] **Krok 6: Commit** — `feat(tests): remember the class a test was made for`.

---

### Úkol 2: Které otázky už jsou v testu

**Soubory:**
- Upravit: `apps/web/src/lib/tests.ts` (nová funkce), `apps/web/src/app/topics/[id]/page.tsx`, `apps/web/src/app/topics/[id]/TopicWorkspace.tsx`, `apps/web/src/components/TopicQuestions.tsx`
- Test: `apps/web/test/tests-usage.test.ts` (nový), e2e `apps/web/e2e/tema-otazky.spec.ts`

**Rozhraní:**
- `loadTestUsageForQuestions(scope: Scope, questionIds: string[]): Promise<Record<string, { testId: string; title: string }[]>>` — jen testy viditelné scope (`viditelnyTest`), každý test u otázky jednou, seřazené podle `tests.updatedAt` sestupně. Prázdný vstup → `{}` bez dotazu.
- `TopicQuestions` dostane prop `usage: Record<string, { testId: string; title: string }[]>`.

Chování na kartě: pod náhledem drobný štítek „V testu: *Název*" (odkaz na `/tests/<id>`); víc testů → „V testu: *Název* a další 2". Filtr vedle typu a obtížnosti: přepínač „Jen nepoužité v testu".

- [ ] **Krok 1: Unit test (padá)** — `tests-usage.test.ts`: otázka ve vlastním testu → vrácena; v testu kolegyně s `visibility: 'soukrome'` → nevrácena (bod revize 1); s `visibility: 'skola'` → vrácena; tentýž test dvakrát u jedné otázky (dvě položky) → jednou; prázdné pole → `{}`. Seedy: `seedTopic`, `seedQuestion`, `seedUcet` z `test/helpers.ts`, test přes `POST` route nebo přímo `db.insert` jako v `tests-api.test.ts`.
- [ ] **Krok 2: Implementace funkce** — dotaz `select questionId, testId, title from test_items join tests where viditelnyTest(scope, tests) and questionId in (…)`, skupina v JS.
- [ ] **Krok 3: e2e (padá)** — v `tema-otazky.spec.ts`: vytvořit test přes API s jednou otázkou tématu (vzor `createTest` v `e2e/testy.spec.ts`) → karta té otázky ukazuje „V testu: …"; zapnout „Jen nepoužité v testu" → ta karta zmizí, ostatní zůstanou.
- [ ] **Krok 4: Zapojení** — stránka tématu načte `usage` pro id otázek v seznamu a předá přes `TopicWorkspace` do `TopicQuestions` (čerstvě vygenerované otázky prostě nemají záznam). Štítek + filtr podle chování výš.
- [ ] **Krok 5: Ověřit a commit** — `pnpm test && pnpm typecheck && pnpm build`; `pnpm exec playwright test e2e/tema-otazky.spec.ts`. Commit: `feat(web): show which questions are already in a test`.

---

### Úkol 3: Zaškrtnout otázky a vytvořit test

**Soubory:**
- Vytvořit: `apps/web/src/components/test-builder/defaults.ts` (výchozí nastavení testu sdílené s `TestBuilder`)
- Vytvořit: `apps/web/src/components/SelectionBar.tsx`
- Upravit: `apps/web/src/components/TopicQuestions.tsx`, `apps/web/src/components/TestBuilder.tsx` (použít `defaults.ts`), `apps/web/src/app/topics/[id]/page.tsx` a `TopicWorkspace.tsx` (předat `topic` metadata a výchozí šablonu)
- Test: e2e `apps/web/e2e/tema-vyber-testu.spec.ts` (nový)

**Rozhraní:**
- `defaults.ts`: `emptyHeader(): TestHeaderConfig` a `defaultTemplateId(templates: { id: string }[]): string` — `TestBuilder` je použije místo dnešního inline literálu (chování beze změny).
- `TopicQuestions` dostane props `topic: { id: string; name: string; subjectName: string; gradeId: string; gradeName: string }` a `defaultTemplateId: string`.
- `SelectionBar({ count, points, busy, onCreate, onClear })` — lepivá lišta dole (`sticky bottom-0`, `surface-chrome`, tokeny), text „Vybráno N · M bodů", tlačítka „Zrušit výběr" a „Vytvořit test" (busy „Vytvářím…"). Seznam karet dostane spodní odsazení, aby lišta nepřekryla poslední kartu.

Chování:
- Každá karta (jen pro `muzeMenit`) má zaškrtávátko „Vybrat do testu"; výběr je množina id v pořadí zaškrtnutí. Otázka skrytá smazáním/přegenerováním z výběru zmizí (bod revize 2). Filtr výběr nemaže.
- Body = součet `question.points` vybraných.
- „Vytvořit test" → `POST /api/tests` s `{ title: topic.name, templateId: defaultTemplateId, header: { ...emptyHeader(), subject: topic.subjectName }, gradeId: topic.gradeId, items: vybrané v pořadí, jak jsou v seznamu shora (ne pořadí zaškrtnutí) jako { id: nový uuid, kind: 'question', questionId, puzzleId: null, text: null, pointsOverride: null, linesOverride: null } }` (tvar položky podle `itemSchema` v `apps/web/src/app/api/tests/route.ts`; `id` generovat stejně jako `TestBuilder`). Úspěch → `router.push('/tests/<id>?tema=<topicId>')`; chyba → `toast.error` s českou hláškou a výběr zůstane.

- [ ] **Krok 1: e2e (padá)** — `tema-vyber-testu.spec.ts` (vlastní téma přes `ensureTopic` vzor z `tema-otazky.spec.ts`): zaškrtnout 2 otázky → lišta „Vybráno 2 · N bodů"; smazat jednu z vybraných → „Vybráno 1"; zaškrtnout další → „Vytvořit test" → URL `/tests/<id>` a v editoru jsou obě otázky v pořadí seznamu; název testu = název tématu. Druhý test: „Zrušit výběr" lištu schová.
- [ ] **Krok 2: Implementace** podle chování výš; `defaults.ts` zapojit i do `TestBuilder`.
- [ ] **Krok 3: Ověřit a commit** — `pnpm test && pnpm typecheck && pnpm build`; `pnpm exec playwright test e2e/tema-vyber-testu.spec.ts e2e/tema-otazky.spec.ts e2e/osnova.spec.ts`; role `nahled` nevidí zaškrtávátka — doplnit do `e2e/role.spec.ts` (login config). Commit: `feat(web): pick questions in a topic and make a test from them`.

---

### Úkol 4: Editor testu podle třídy

**Soubory:**
- Upravit: `apps/web/src/lib/questionPicker.ts` (`PickerTopic.gradeId`), `apps/web/src/app/tests/[id]/page.tsx`, `apps/web/src/app/tests/new/page.tsx`, `apps/web/src/components/TestBuilder.tsx`, `apps/web/src/components/test-builder/BankPanel.tsx`, `apps/web/src/components/test-builder/types.ts`
- Test: `apps/web/test/questionPicker.test.ts`, e2e `apps/web/e2e/tema-vyber-testu.spec.ts`

**Rozhraní:**
- `PickerTopic` dostane `gradeId: string`.
- `TestBuilder` dostane props `gradeId: string | null` (z `loadTest`), `gradeLabel: string | null` (např. „Přírodopis · 6. ročník", stránka ho dohledá) a `backTopic: { id: string; name: string } | null` (z `?tema=` — stránka ověří, že téma patří škole, jinak `null`).
- `BankFilters.grade` přechází z názvu na `gradeId`; výchozí hodnota filtru = `gradeId` testu (nebo „všechny", když test ročník nemá). V nabídce ročníků jsou položky „Předmět · ročník" s `gradeId` jako hodnotou.

Chování:
- Hlavička editoru: štítek třídy (`gradeLabel`), a pokud je `backTopic`, odkaz „← Zpět do tématu *Název*".
- Banka otázek v editoru je předfiltrovaná na třídu testu; přepnutím filtru jde vybrat jinou třídu nebo všechny (tak vzniká opakovací test přes víc témat). Test bez třídy → „Všechny třídy" jako dřív (bod revize 5).
- Když se do testu bez třídy přidají otázky, třída se nedoplňuje automaticky (jednoduchost; `gradeId` nastavuje jen vytvoření z tématu).

- [ ] **Krok 1: Testy (padají)** — `questionPicker.test.ts`: `loadPickerTopics` vrací `gradeId`. e2e v `tema-vyber-testu.spec.ts`: po „Vytvořit test" editor ukazuje štítek třídy a odkaz zpět do tématu; banka ukazuje témata třídy (seed druhého tématu v jiném ročníku, to se ve výchozím filtru neukáže, po přepnutí na „Všechny třídy" ano).
- [ ] **Krok 2: Implementace** podle chování výš. `RandomDialog` používá `grade` jako text — ponechat (jen číst nové pole, pokud se to hodí), neměnit jeho chování.
- [ ] **Krok 3: Ověřit a commit** — `pnpm test && pnpm typecheck && pnpm build`; `pnpm exec playwright test e2e/tema-vyber-testu.spec.ts e2e/osnova.spec.ts e2e/nahodny-test.spec.ts e2e/tisk.spec.ts`. Commit: `feat(web): offer the test's own class first when adding questions`.

---

### Úkol 5: Přehled testů podle třídy

**Soubory:**
- Upravit: `apps/web/src/lib/tests.ts` (`testConditions`/`TestQuery` + `gradeId`), `apps/web/src/app/tests/page.tsx`, `apps/web/src/app/tests/TestsFilters.tsx`, `apps/web/src/app/tests/TestsTable.tsx`
- Test: `apps/web/test/tests-api.test.ts` (GET s `gradeId`), e2e `apps/web/e2e/testy.spec.ts`

Chování: přehled má sloupec „Třída" („Předmět · ročník", prázdné u testů bez třídy) a filtr „Všechny třídy / …" vedle šablony; volba se propisuje do URL (`?trida=<gradeId>`) stejně jako hledání. Nabídka tříd = ročníky školy, ve kterých existuje aspoň jeden viditelný test.

- [ ] **Krok 1: Testy (padají)** — GET `/api/tests?gradeId=` vrací jen testy té třídy; e2e: dva testy v různých třídách, filtr ukáže jen jeden a URL obsahuje `trida=`.
- [ ] **Krok 2: Implementace**.
- [ ] **Krok 3: Ověřit a commit** — `pnpm test && pnpm typecheck && pnpm build`; `pnpm exec playwright test e2e/testy.spec.ts`. Commit: `feat(web): filter tests by class`.

---

## Po dokončení

- `pnpm test`, `pnpm typecheck`, `pnpm build`, celá Playwright sada (výchozí i login config).
- Majitel spustí migraci 0015 nad ostrou databází (`cd apps/web && pnpm db:migrate`) — spolu s 0014, pokud ji ještě nespustil.
