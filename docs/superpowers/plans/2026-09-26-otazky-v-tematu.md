# Otázky v tématu bez schvalování — plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cíl:** Vygenerovaná otázka je hned použitelná, schvalování zmizí z rozhraní a učitelka s otázkami pracuje přímo v tématu — seznam karet, úprava na místě, smazání s „Vrátit zpět".

**Architektura:** Stav otázky zůstává v databázi (`draft | approved | rejected`), ale aplikace už `draft` nevytváří: všechny zápisy ukládají `approved`, jednorázová migrace 0014 převede zbylé koncepty (vzor migrace 0006). Smazání otázky v tématu i v bance je měkké — `PUT /api/questions { ids, status: 'rejected' }` — a vrácení vrací předchozí stav přes existující `planUndo`. Seznam otázek v tématu je nová komponenta `TopicQuestions` místo `ReviewPanel`; úprava používá formulář `QuestionEditorForm` vyjmutý z dialogu `QuestionEditor`.

**Tech stack:** Next.js App Router, React, Drizzle (libsql/SQLite), zod, vitest, Playwright, shadcn/ui v `packages/ui`.

**Spec:** `docs/superpowers/specs/2026-09-25-zjednoduseni-ucitelka-design.md` — kapitoly „Stránka tématu (Otázky)", „Změny v datech (Otázky)", pořadí prací krok 2.

## Globální omezení

- Kód, komentáře, texty v rozhraní česky; commity anglicky podle Conventional Commits, zakončené řádkem `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Žádný test ani skript nesahá na `apps/web/local.db` a na server na portu 3000 (běží na něm majitelova aplikace — nevypínat, nevolat). Prohlížečové testy jen přes Playwright (port 3100, `e2e.db`).
- Každá funkce v `apps/web/src/lib/*` bere `Scope`; cizí otázka se tváří jako neexistující.
- Barvy jen přes tokeny z `packages/ui/src/styles.css`; žádné `bg-white` apod. Token `draft` (`bg-draft-bg`, `text-draft-fg`) je obecná „upozorňovací" barva — nemazat.
- Typ `QuestionStatus` ponechává `'draft'` (starší řádky, návrat migrace, testy); aplikace ho jen nezapisuje.
- Slovo „rejected" má v kódu dva významy: stav otázky v DB a počet výstupů modelu zahozených validací (`GenerateOutcome.rejected`, SSE `done`, `readQuestionFile().rejected`). Tento plán mění jen stav v DB.
- `/review`, `ReviewScreen`, `ReviewQueue` a `review.spec.ts` zůstávají (odstraní je krok 5 specu); jen z nich zmizí odkazy z navigace a tématu.
- Ověření po každém úkolu: `pnpm test`, `pnpm typecheck`; u úkolů s rozhraním i `pnpm build` a příslušné Playwright testy (`cd apps/web && pnpm exec playwright test <spec>`).
- Do commitů jen vyjmenované soubory (`git add <soubor>`), nikdy `git add -A`.

## Na co si dát pozor při revizi

1. **Otázka smazaná ze seznamu je použitá v uloženém testu** — test ji dál tiskne (drží `questionSnapshot`); text potvrzení nesmí tvrdit, že z testu zmizí. Test v úkolu 3.
2. **„Vrátit zpět" po smazání otázky, která byla před smazáním `draft`** (před spuštěním migrace) — vrátí se `draft`, ne `approved`. Test v úkolu 3.
3. **Učitelka upravuje otázku a mezitím doběhne generování** (nové otázky přibudou do seznamu) — rozpracovaná úprava se nesmí zavřít ani ztratit. Test v úkolu 5.
4. **Náhled (role `nahled`)** vidí seznam, ale ne tlačítka Upravit/Smazat/Přegenerovat/Nová otázka. Test v úkolu 5.
5. **Migrace nad databází bez konceptů** proběhne bez chyby a nic nezmění. Test v úkolu 2.

---

### Úkol 1: Nové otázky jsou rovnou použitelné

**Soubory:**
- Upravit: `apps/web/src/lib/questions.ts:209` (výchozí stav v `insertQuestions`)
- Upravit: `apps/web/src/lib/generation.ts:204` a `:340` (dávka a náhrada)
- Upravit: `apps/web/src/lib/questionFile.ts` (import z Claude Code)
- Test: `apps/web/test/regenerate.test.ts`, `apps/web/test/question-file.test.ts`, `apps/web/test/generation-models.test.ts` (nebo jiný test, kde se dá ověřit stav nové otázky)

**Rozhraní:**
- `insertQuestions(scope, items, { topicId, materialId?, source?, status? })` — výchozí `status` je `'approved'`.

- [ ] **Krok 1: Testy na stav nových otázek**

V `apps/web/test/regenerate.test.ts` změnit očekávání u náhrady z `'draft'` na `'approved'` (původní otázka zůstává `'rejected'`); test „zaneprázdněné téma nechá původní otázku beze změny" upravit tak, aby očekával původní stav seedované otázky (seedovat ji jako `'approved'`). Do `apps/web/test/question-file.test.ts` přidat do prvního testu:

```ts
    expect(ulozene.map((q) => q.status)).toEqual(['approved'])
```

Do `apps/web/test/generation-models.test.ts` (test „uloží otázky z obou modelů") přidat ověření, že všechny uložené otázky tématu mají `status === 'approved'`.

- [ ] **Krok 2: Ověřit, že testy padají**

Spustit: `cd apps/web && pnpm exec vitest run test/regenerate.test.ts test/question-file.test.ts test/generation-models.test.ts`
Očekávat: FAIL — otázky vznikají jako `draft`.

- [ ] **Krok 3: Implementace**

V `insertQuestions` změnit `context.status ?? 'draft'` na `context.status ?? 'approved'` a upravit komentář (koncepty se už nevytvářejí; stav `draft` zůstává jen u starších řádků). V `generation.ts` (dávka i náhrada) a `questionFile.ts` smazat `status: 'draft'` z volání `insertQuestions` (výchozí stačí). Komentáře, které mluví o konceptech „ke kontrole", přepsat.

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`
Očekávat: PASS. Testy, které dál seedují `draft` kvůli frontě `/review` (`questions-list-api.test.ts`, `questions-bank.test.ts`), nechat — fronta zůstává do kroku 5.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/lib/questions.ts apps/web/src/lib/generation.ts apps/web/src/lib/questionFile.ts \
  apps/web/test/regenerate.test.ts apps/web/test/question-file.test.ts apps/web/test/generation-models.test.ts
git commit -m "feat(questions): save generated questions ready to use

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 2: Migrace 0014 — zbylé koncepty na schválené

**Soubory:**
- Vytvořit: `apps/web/drizzle/0014_approve-remaining-drafts.sql`
- Upravit: `apps/web/drizzle/meta/_journal.json` (záznam `idx: 14`)
- Vytvořit: `apps/web/test/migrate-approve-remaining-drafts.test.ts`
- Vytvořit: `docs/migrace-0014-zbyle-koncepty.md`

Vzor je migrace 0006 (`apps/web/drizzle/0006_approve-existing-drafts.sql`, test `apps/web/test/migrate-approve-drafts.test.ts`, dokument `docs/migrace-0006-schvaleni-konceptu.md`) — tvar převzít, texty přizpůsobit.

- [ ] **Krok 1: Test migrace (padá)**

`apps/web/test/migrate-approve-remaining-drafts.test.ts` — zkopírovat postup z `migrate-approve-drafts.test.ts`: databáze postavená migracemi po `0013_puzzle-word-drafts` (`migrationsUpTo('0013_puzzle-word-drafts')`), vložit otázky ve všech třech stavech, pustit plnou sadu migrací a ověřit:
- počet `draft` je 0, `approved` vzrostl přesně o počet konceptů, `rejected` beze změny,
- pomocná tabulka `migration_0014_approved_drafts` obsahuje přesně id převedených otázek,
- druhý test: návratový postup z komentáře migrace vrátí přesně převedené otázky zpět na `draft` a otázku, kterou mezitím někdo zamítl, nechá být,
- třetí test: databáze bez konceptů — migrace proběhne a nic nezmění (tabulka prázdná).

Pozor: návratový postup nesmí mazat záznam z `__drizzle_migrations` přes `ORDER BY created_at DESC LIMIT 1` (0014 nemusí být poslední); smaže ho podle hashe souboru migrace. Jak drizzle hash počítá, ověřit v `node_modules/drizzle-orm/migrator.js` (sha256 obsahu souboru) a v testu použít stejný výpočet.

- [ ] **Krok 2: Ověřit, že padá**

Spustit: `cd apps/web && pnpm exec vitest run test/migrate-approve-remaining-drafts.test.ts`
Očekávat: FAIL — migrace neexistuje.

- [ ] **Krok 3: Migrace a rejstřík**

`0014_approve-remaining-drafts.sql` — stejná tři `statement-breakpoint` kroky jako 0006 s tabulkou `migration_0014_approved_drafts`, hlavičkový komentář: proč (schvalování zrušeno, generování ukládá rovnou použitelné otázky), návratový postup (UPDATE zpět jen `status = 'approved' AND id IN (…)`, `DROP TABLE`, smazání záznamu z `__drizzle_migrations` podle hashe — `SELECT hash, created_at FROM __drizzle_migrations` a vybrat řádek této migrace). Do `meta/_journal.json` přidat záznam ve stejném tvaru jako předchozí (`idx: 14`, `version` jako u 13, `when` = aktuální čas v ms, `tag: "0014_approve-remaining-drafts"`, `breakpoints: true`).

`docs/migrace-0014-zbyle-koncepty.md` — co dělá, proč, jak se pustí (`cd apps/web && pnpm db:migrate`, „pozor: nad local.db to jsou ostrá data", kontrolní dotaz `SELECT status, count(*) FROM questions GROUP BY status;`), jak zpět.

- [ ] **Krok 4: Ověřit**

Spustit: `pnpm test && pnpm typecheck`; `cd apps/web && pnpm --filter @testmaker/web e2e:db` jen pokud e2e databáze vzniká migracemi a soubor chybí — jinak nic. **Migraci nad `local.db` nespouštět** — to udělá majitel.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/drizzle/0014_approve-remaining-drafts.sql apps/web/drizzle/meta/_journal.json \
  apps/web/test/migrate-approve-remaining-drafts.test.ts docs/migrace-0014-zbyle-koncepty.md
git commit -m "feat(db): approve the remaining drafts now that review is gone

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 3: Smazání otázky jde vrátit

**Soubory:**
- Vytvořit: `apps/web/src/lib/questionStatusClient.ts` (klientské volání stavu + vrácení)
- Upravit: `apps/web/src/app/questions/QuestionsTable.tsx` (hromadné „Smazat" v bance)
- Test: `apps/web/test/questions-bank.test.ts` (API: měkké smazání a vrácení), e2e v úkolu 5

**Rozhraní:**
- Produkuje (klient): `rejectQuestions(questions: Pick<Question, 'id' | 'status'>[]): Promise<[string, QuestionStatus][]>` — zapíše `rejected` přes `PUT /api/questions { ids, status: 'rejected' }` a vrátí předchozí stavy; `restoreStatuses(previous: [string, QuestionStatus][]): Promise<void>` — po dávkách podle `planUndo` (z `@testmaker/ui`) vrátí stavy.
- `DELETE /api/questions` (tvrdé smazání) zůstává beze změny, rozhraní ho přestane používat.

- [ ] **Krok 1: Test API (měkké smazání a vrácení)**

Do `apps/web/test/questions-bank.test.ts` přidat test: otázka `draft` a otázka `approved` → `PUT { ids, status: 'rejected' }` → obě `rejected`; `loadPickerTopics` je nenabízí; vrácení dvěma `PUT` (po stavech) → první zpět `draft`, druhá `approved`. Test položky testu: otázka použitá v uloženém testu (seed testu s `questionSnapshot`, vzor v `apps/web/test/tests-api.test.ts`) po `rejected` v testu zůstává a snapshot je beze změny.

- [ ] **Krok 2: Ověřit**

Spustit: `cd apps/web && pnpm exec vitest run test/questions-bank.test.ts`
Očekávat: PASS hned (API to už umí) — test je pojistka chování, na které stavíme. Pokud neprojde, nejdřív opravit API.

- [ ] **Krok 3: `questionStatusClient.ts`**

```ts
'use client'

import type { QuestionStatus } from '@testmaker/core/schema'
import { planUndo } from '@testmaker/ui'

/**
 * Smazání otázky je jen změna stavu na `rejected` — otázka zmizí ze seznamů
 * i z výběru do testu, ale dá se vrátit. Uložené testy ji tisknou dál ze
 * svého snímku, takže je smazání nepoškodí.
 */
async function writeStatus(ids: string[], status: QuestionStatus): Promise<void> {
  if (ids.length === 0) return
  const response = await fetch('/api/questions', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids, status }),
  })
  if (!response.ok) throw new Error('Změnu se nepodařilo uložit. Zkus to prosím znovu.')
}

/** Smaže otázky a vrátí jejich stavy před smazáním (pro „Vrátit zpět"). */
export async function rejectQuestions(
  questions: { id: string; status: QuestionStatus }[],
): Promise<[string, QuestionStatus][]> {
  const previous = questions.map((q): [string, QuestionStatus] => [q.id, q.status])
  await writeStatus(questions.map((q) => q.id), 'rejected')
  return previous
}

/** Vrátí otázkám stavy, které měly před smazáním (mohly se lišit). */
export async function restoreStatuses(previous: [string, QuestionStatus][]): Promise<void> {
  for (const step of planUndo(previous)) await writeStatus(step.ids, step.status)
}
```

(Ověřit, že `planUndo` je z `@testmaker/ui` exportované; pokud ne, importovat ze stejného místa jako `ReviewPanel.tsx`.)

- [ ] **Krok 4: Banka**

V `QuestionsTable.tsx` nahradit `removeSelected()` (dnes `DELETE`) voláním `rejectQuestions` + `router.refresh()` + `toast.success('Smazáno: N otázek', { duration: 10_000, action: { label: 'Vrátit zpět', onClick: … restoreStatuses … } })`. Text potvrzovacího dialogu (dnes „Pokud jsou použité v uloženém testu, zmizí i odtamtud") nahradit: „Otázky zmizí z banky i z výběru do testu. Uložené testy je vytisknou dál. Smazání půjde hned vrátit." Chyby zobrazit `toast.error` s hláškou z výjimky.

- [ ] **Krok 5: Ověřit a commit**

Spustit: `pnpm test && pnpm typecheck && pnpm build`; `cd apps/web && pnpm exec playwright test e2e/banka.spec.ts` — upravit případná očekávání textu mazání.

```bash
git add apps/web/src/lib/questionStatusClient.ts apps/web/src/app/questions/QuestionsTable.tsx \
  apps/web/test/questions-bank.test.ts
# + apps/web/e2e/banka.spec.ts, pokud se měnil
git commit -m "feat(questions): make deleting a question undoable

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 4: Formulář úpravy otázky bez dialogu

**Soubory:**
- Upravit: `apps/web/src/components/QuestionEditor.tsx`

**Rozhraní:**
- Produkuje: `QuestionEditorForm({ topicId, question, onCancel, onSaved }: { topicId: string; question: Question | null; onCancel: () => void; onSaved: (saved?: Question) => void })` — celý dnešní obsah dialogu (pole, uložení `PATCH`/`POST`, chyby) bez `Dialog`.
- `QuestionEditor` (dialog) zůstává se stejnými props a jen obaluje `QuestionEditorForm` — ostatní místa (banka, `/review`) se nemění.

- [ ] **Krok 1: Vyjmout formulář**

Obsah mezi `<DialogContent>` a `</DialogContent>` (kromě `DialogHeader`) přesunout do `QuestionEditorForm`; stav a uložení jdou s ním. `QuestionEditor` = `Dialog` + `DialogHeader` + `<QuestionEditorForm … onCancel={onClose} onSaved={() => onSaved()} />`. Tlačítka Uložit/Zrušit patří do formuláře. Chování beze změny.

- [ ] **Krok 2: Ověřit a commit**

Spustit: `pnpm typecheck && pnpm build`; `cd apps/web && pnpm exec playwright test e2e/banka.spec.ts e2e/kontrola.spec.ts` (úprava otázky v dialogu musí fungovat jako dřív).

```bash
git add apps/web/src/components/QuestionEditor.tsx
git commit -m "refactor(web): let the question form live outside a dialog

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 5: Seznam otázek v tématu

**Soubory:**
- Vytvořit: `apps/web/src/components/TopicQuestions.tsx`
- Upravit: `apps/web/src/app/topics/[id]/TopicWorkspace.tsx` (místo `<ReviewPanel …/>`), `apps/web/src/app/topics/[id]/page.tsx` (načítání bez `rejected`)
- Vytvořit: `apps/web/e2e/tema-otazky.spec.ts`
- Smazat: `apps/web/e2e/kontrola.spec.ts` (testoval kontrolu konceptů v tématu, která mizí)

**Rozhraní:**
- `TopicQuestions({ topicId, questions }: { topicId: string; questions: Question[] })`.
- Konzumuje: `QuestionEditorForm` (úkol 4), `rejectQuestions`/`restoreStatuses` (úkol 3), `RegenerateButton({ questionId, type, onDone? })`, `QuestionPreview` z `@testmaker/ui`, `useMuzeMenit()` z `@/components/Prava`, `QUESTION_TYPE_LABELS`, `DEFAULT_POINTS` ze schématu.

Chování (ze specu, kapitola „Otázky"):
- Karty seřazené od nejnovější (`createdAt` sestupně), otázky `rejected` se nezobrazují (stránka je ani nenačte: `loadQuestions(ucet, { topicId, statuses: ['draft', 'approved'] })`, `draft` jen do spuštění migrace).
- Karta: `QuestionPreview` (se správnou odpovědí), nahoře typ (`QUESTION_TYPE_LABELS`), body a obtížnost (Lehká/Střední/Těžká).
- Kliknutí na „Upravit" rozbalí kartu do `QuestionEditorForm`; Uložit → `router.refresh()`, karta se zavře; Zrušit zavře bez změny. Upravovaná karta se drží podle `id`, takže přibývající otázky z generování ji nezavřou (spec, bod revize 3).
- Akce u karty: Upravit · Přegenerovat (`RegenerateButton`) · Smazat. Smazat bez potvrzovacího dialogu → `rejectQuestions([q])` → karta hned zmizí (optimisticky, lokální množina skrytých id) → `toast.success('Otázka smazána', { duration: 10_000, action: { label: 'Vrátit zpět', onClick: restore } })`; chyba → karta se vrátí a `toast.error`.
- Nahoře: tlačítko „Nová otázka" (otevře prázdný `QuestionEditorForm` nad seznamem) a filtr typ + obtížnost (klientský, nad načteným seznamem). Filtr „nepoužité v testu" a zaškrtávání do testu patří do kroku 3 specu — tady ne.
- Bez otázek: `EmptyState` „V tématu zatím nejsou otázky. Nech je vygenerovat, nebo napiš první sama."
- Bez práva měnit (`useMuzeMenit() === false`): jen náhledy, žádná tlačítka.

- [ ] **Krok 1: e2e test (padá)**

`apps/web/e2e/tema-otazky.spec.ts` (fixtury jako v `apps/web/e2e/fixtures.ts`, `testTopicPath`): 
1. seznam ukazuje otázky tématu jako karty, nejnovější první;
2. „Upravit" → změna zadání → Uložit → karta ukazuje nové zadání; během úpravy `page.evaluate` nic nemění — stačí ověřit, že formulář zůstane otevřený po `router.refresh` vyvolaném jinou akcí (např. smazání jiné karty);
3. „Smazat" → karta zmizí → „Vrátit zpět" v toastu → karta je zpět;
4. filtr typu schová karty jiného typu;
5. účet s rolí `nahled` (vzor v `apps/web/e2e/role.spec.ts`) nevidí Upravit/Smazat/Nová otázka.

Spustit: `cd apps/web && pnpm exec playwright test e2e/tema-otazky.spec.ts` → FAIL.

- [ ] **Krok 2: Komponenta a zapojení**

Napsat `TopicQuestions.tsx` podle chování výš (klientská komponenta, `'use client'`, texty česky, barvy jen tokeny, prvky z `@testmaker/ui` — `Card`, `Button`, `Select`/`DropdownMenu`, `Badge`, `EmptyState`). V `TopicWorkspace.tsx` nahradit `<ReviewPanel topicId={topicId} questions={shownQuestions} />` za `<TopicQuestions topicId={topicId} questions={shownQuestions} />` a odstranit import `ReviewPanel`. V `page.tsx` načítat otázky bez `rejected` (viz výš). `kontrola.spec.ts` smazat (`git rm`).

- [ ] **Krok 3: Ověřit**

Spustit: `pnpm test && pnpm typecheck && pnpm build`; `cd apps/web && pnpm exec playwright test e2e/tema-otazky.spec.ts e2e/stranka.spec.ts e2e/generovani.spec.ts e2e/prubeh-generovani.spec.ts`
Očekávat: PASS.

- [ ] **Krok 4: Commit**

```bash
git rm apps/web/e2e/kontrola.spec.ts
git add apps/web/src/components/TopicQuestions.tsx "apps/web/src/app/topics/[id]/TopicWorkspace.tsx" \
  "apps/web/src/app/topics/[id]/page.tsx" apps/web/e2e/tema-otazky.spec.ts
git commit -m "feat(web): work with a topic's questions as cards, edit in place

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Úkol 6: Úklid zbytků schvalování v rozhraní

**Soubory (podle průzkumu):**
- `apps/web/src/app/topics/[id]/page.tsx` — dlaždice `StatRow` „ke kontrole" pryč; `draftCount` pryč; `keptCount` → počet otázek bez `rejected` (`statuses: ['draft', 'approved']`, přejmenovat na `usableCount` v obou souborech).
- `apps/web/src/app/topics/[id]/TopicWorkspace.tsx` — text „Vznikne N ke kontrole." → „Vznikne N otázek."; toast po generování „Hotovo, N ke kontrole" + akce „Zkontrolovat" (odkaz na `/review`) → „Hotovo, N nových otázek." bez akce.
- `apps/web/src/lib/library.ts` — `draftCount` z `TopicNode` pryč (a jeho SQL); `approvedCount` ponechat jen pokud ho něco zobrazuje, jinak sloučit do počtu otázek bez `rejected`.
- `apps/web/src/components/TopicTile.tsx` (štítek „N ke kontrole"), `LibrarySidebar.tsx` a `TopicList.tsx` (`flag: … draftCount > 0`) — pryč.
- `apps/web/src/components/MainNav.tsx` — položka „Kontrola" a `usePendingCount` pryč (stránka `/review` zůstává dostupná adresou do kroku 5).
- `apps/web/src/app/questions/QuestionsTable.tsx` + `apps/web/src/app/questions/page.tsx` — ve filtru stavu zrušit volbu „Koncept"; štítek stavu u řádku ukazovat jen „Smazáno" pro `rejected` (a volbu filtru „Smazané" ponechat, ať jde smazané najít a vrátit); výchozí filtr banky bez smazaných.
- `apps/web/src/components/ReviewPanel.tsx` — pokud už ho nic neimportuje, smazat (`git rm`).
- Testy: upravit `apps/web/test/library-api.test.ts`, `topics-api.test.ts`, `questions-bank.test.ts` a e2e (`banka.spec.ts`, `rozhrani.spec.ts`, `layout.spec.ts`, `screens.spec.ts`, `review.spec.ts` — ten jen pokud chodí na `/review` přes navigaci; ať jde přímo adresou), které očekávají odstraněné texty nebo položku navigace.

- [ ] **Krok 1: Úpravy**

Provést změny výš. Pro každý odstraněný text najít jeho testy (`grep -rn "ke kontrole\|Kontrola\|Koncept" apps/web/src apps/web/test apps/web/e2e packages/ui/src`) a upravit je; kde test ověřoval jen zmizelou věc, test smazat. Hledání `grep -rn "ke kontrole" apps/web/src packages/ui/src` musí po úkolu vrátit nanejvýš výskyty v `app/review/` a `packages/ui/src/ReviewQueue.tsx` (zůstávají do kroku 5).

- [ ] **Krok 2: Ověřit**

Spustit: `pnpm test && pnpm typecheck && pnpm build`; `cd apps/web && pnpm exec playwright test` (celá sada, port 3100).
Očekávat: PASS.

- [ ] **Krok 3: Commit**

```bash
git add <každý změněný soubor výslovně>
git rm apps/web/src/components/ReviewPanel.tsx   # jen pokud se mazal
git commit -m "refactor(web): drop the leftovers of question review from the interface

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Po dokončení

- `pnpm test`, `pnpm typecheck`, `pnpm build`, celá Playwright sada.
- Majitel spustí migraci nad ostrou databází: `cd apps/web && pnpm db:migrate` (postup a návrat v `docs/migrace-0014-zbyle-koncepty.md`).
