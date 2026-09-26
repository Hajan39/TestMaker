# Úvod „Třídy" a úklid lišty — plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cíl:** Aplikace začíná výběrem třídy, lišta má jen Třídy · Testy · Hlavolamy · Šablony (+ Správa), smazané otázky jdou obnovit přímo v tématu a mrtvé obrazovky (Kontrola, Banka) zmizí.

**Architektura:** Úvod `/` ukazuje dlaždice tříd seskupené podle předmětu (data z `loadLibraryTree`). Třída má vlastní stránku `/tridy/[gradeId]` se seznamem témat, počty a ukazatelem běžícího generování; správa předmětů a ročníků zůstává na úvodu. Poslední otevřená třída se pamatuje v `localStorage` (vzor `ThemeToggle`). `/review` a `/questions` se mažou a přesměrují na `/` (page-level `redirect()`); `/import` a `/generovani` zůstávají dostupné, jen ne z lišty. Ukazatel generování vede do tématu, když běží/čeká právě jedno, jinak na `/generovani`.

**Tech stack:** Next.js App Router, React, Drizzle, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-zjednoduseni-ucitelka-design.md` — „Lišta a úvodní obrazovka", pořadí prací krok 5, a rozhodnutí majitele z 2026-09-26 (doplněná do specu v úkolu 4 tohoto plánu):
- hromadný import složky zůstává jako tlačítko „Hromadný import" na úvodu (a v prázdné knihovně), ne v liště;
- přehled generování (`/generovani`) zůstává, ne v liště; ukazatel na něj vede, když běží víc úloh nebo něco selhalo;
- banka otázek se ruší, v tématu přibude filtr „Smazané" s obnovením;
- stránka Kontrola se maže.

## Globální omezení

- Česky; commity anglicky se `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Nikdy `apps/web/local.db` ani port 3000; Playwright jen přes jeho konfigurace.
- `proxy.ts` se nemění (Edge, jen `lib/session.ts`).
- Každý dotaz přes `Scope`; cizí třída/téma → 404.
- `localStorage` jen v `useEffect` a v `try/catch` (vzor `packages/ui/src/ThemeToggle.tsx`).
- Tokeny, `surface-*`, mobil 360 px bez vodorovného posunu.
- Role `nahled` vidí třídy a témata, nevidí přidávání, přejmenování, mazání, import ani generování.
- Mazání souborů `git rm`; žádný mrtvý kód po smazaných stránkách (ověřit grepem importy).
- Po každém úkolu `pnpm test`, `pnpm typecheck`, `pnpm build` a dotčené Playwright specy; na konci celá sada na čerstvé `e2e.db` (výchozí i login config).

## Na co si dát pozor při revizi

1. **Zapamatovaná třída mezitím smazaná** — úvod ji tiše zapomene a ukáže dlaždice, ne 404. Test v úkolu 2.
2. **Stará adresa `/?grade=<id>` a staré odkazy na `/questions`, `/review`** — vedou na novou třídu / úvod. Test v úkolu 3.
3. **Ukazatel generování při jedné úloze vs. více / chybě** — správný cíl odkazu. Test v úkolu 3.
4. **Obnovení smazané otázky v tématu** — vrátí se do seznamu i do počtů; smazané se v běžném seznamu neukazují. Test v úkolu 1.
5. **Prázdná knihovna** — úvod nabídne „Hromadný import" a „Založit předmět". Test v úkolu 2.

---

### Úkol 1: Smazané otázky v tématu

**Soubory:** `apps/web/src/components/TopicQuestions.tsx` (+ `QuestionCard.tsx`), případně `apps/web/src/app/api/questions/route.ts` (GET s `topicId` a `status=rejected` už existuje — ověřit), e2e `apps/web/e2e/tema-otazky.spec.ts`.

Chování: vedle filtrů přepínač „Smazané (N)" (jen `muzeMenit`; N = počet smazaných v tématu, načtený se stránkou). Zapnutý přepínač načte smazané otázky tématu (`GET /api/questions?topicId=…&status=rejected`) a ukáže je jako karty v tlumené podobě s jediným tlačítkem „Obnovit" (→ `restoreStatuses([[id, 'approved']])` + `router.refresh()` + toast „Otázka obnovena"). Běžný seznam smazané dál neukazuje. Počet N se po obnovení sníží.

- [ ] e2e (padá): smazat otázku → „Smazané (1)" → zapnout → karta s „Obnovit" → obnovit → karta zpět v seznamu, „Smazané (0)"; role `nahled` přepínač nevidí (login `role.spec.ts`).
- [ ] Implementace; ověřit; commit `feat(web): find and restore deleted questions in the topic`.

---

### Úkol 2: Úvod „Třídy" a stránka třídy

**Soubory:** `apps/web/src/app/page.tsx` (přestavba), nové `apps/web/src/app/tridy/[gradeId]/page.tsx`, komponenty `apps/web/src/components/ClassTiles.tsx`, `apps/web/src/components/ClassTopics.tsx`, `apps/web/src/components/RememberClass.tsx` (klientská: zapíše poslední třídu; na úvodu přesměruje, pokud je zapamatovaná a existuje — s odkazem „Všechny třídy" `/?vse=1`, který přesměrování potlačí), `apps/web/src/lib/library.ts` (případně `loadClassTopics(scope, gradeId)` s počty a stavem generování: běží/čeká podle `generation_jobs`), odkaz „← třída" v hlavičce stránky tématu (`apps/web/src/app/topics/[id]/page.tsx`), e2e `apps/web/e2e/knihovna.spec.ts`, `deleting.spec.ts`, `layout.spec.ts`, `rozhrani.spec.ts`, `screens.spec.ts`, `vyber-a-motiv.spec.ts` (úpravy), nový `apps/web/e2e/tridy.spec.ts`.

Chování:
- Úvod: hledání v knihovně (`LibrarySearch`) nahoře; pod ním předměty jako sekce s dlaždicemi „Předmět · ročník" (počet témat a otázek); u předmětu Přejmenovat / Přidat ročník / Smazat (dnešní dialogy); tlačítka „Založit předmět", „Hromadný import" (`/import`), „Nový test". Prázdná knihovna: `EmptyState` s „Hromadný import" a „Založit předmět".
- Stránka třídy `/tridy/[gradeId]`: nadpis „Předmět · ročník" (přejmenování ročníku), seznam témat (název s přejmenováním na místě, počet materiálů a otázek, „Generuje se…"/„Čeká ve frontě" podle úloh, štítek „málo materiálu"), „Přidat téma", u tématu „Přesunout do…" (výběr ročníku téhož předmětu, `PATCH /api/topics`), „Vygenerovat pro celou třídu" (dnešní `BulkGenerate`), „Smazat ročník". Cizí/neexistující třída → `notFound()`.
- `RememberClass`: stránka třídy i tématu zapíše `gradeId`; úvod bez `?vse=1` po načtení přesměruje na zapamatovanou třídu, pokud je v datech úvodu (jinak klíč smaže).
- `ThreePane` se na úvodu nepoužívá (jednoduchý jednosloupcový obsah); stránka tématu zůstává, jak je.

- [ ] e2e (padá) v `tridy.spec.ts`: dlaždice třídy vede na stránku třídy; po návštěvě třídy nová návštěva `/` skončí na ní; „Všechny třídy" ukáže dlaždice; smazaná zapamatovaná třída → úvod ukáže dlaždice (bod revize 1); prázdná knihovna (vlastní škola v login configu nebo mock) → výzva s importem (bod revize 5, pokud jde v e2e rozumně připravit — jinak unit test komponenty); přidání a přesun tématu na stránce třídy. Upravit dotčené specy na novou strukturu.
- [ ] Implementace; ověřit; commit `feat(web): start from classes instead of the library tree`.

---

### Úkol 3: Lišta, přesměrování, ukazatel, úklid

**Soubory:** `apps/web/src/components/MainNav.tsx` (Třídy `/`, Testy, Hlavolamy, Šablony; Správa pro správce; aktivní položka „Třídy" i pro `/tridy/*` a `/topics/*`), `apps/web/src/app/review/page.tsx` a `apps/web/src/app/questions/page.tsx` → jen `redirect('/')`, `apps/web/src/app/page.tsx` (`?grade=<id>` → `redirect('/tridy/<id>')`), `apps/web/src/components/GenerationStatus.tsx` + `apps/web/src/app/api/jobs/route.ts` / `apps/web/src/lib/jobs.ts` (počty + `topicId`, když běží/čeká právě jedna úloha a nic neselhalo), smazat `ReviewScreen.tsx`, `QuestionsTable.tsx`, `QuestionActions.tsx`, další komponenty použité jen jimi (`ReviewQueue` v `packages/ui` a jeho export, pokud nic jiného nepoužívá — grep), `e2e/review.spec.ts`, `e2e/banka.spec.ts` (co z něj platí pro téma, už pokrývá úkol 1 a `tema-otazky.spec.ts`), úpravy `e2e/fronta.spec.ts` (nezačínat na `/questions`), `layout.spec.ts` (bez `/questions`), `screens.spec.ts`.

- [ ] Testy (padají): `/questions?…` a `/review?…` → `/`; `/?grade=<id>` → `/tridy/<id>`; lišta má přesně Třídy · Testy · Hlavolamy · Šablony (+ Správa u správce); ukazatel s jednou úlohou vede na `/topics/<id>`, s více nebo s chybou na `/generovani` (`fronta.spec.ts` s `page.route` na `/api/jobs`); `pnpm build` bez odkazů na smazané moduly.
- [ ] Implementace; celá sada na čerstvé `e2e.db` (výchozí i login); commit `refactor(web): trim the nav to classes, tests, puzzles and templates`.

---

### Úkol 4: Spec a dokumentace

**Soubory:** `docs/superpowers/specs/2026-09-25-zjednoduseni-ucitelka-design.md` (doplnit rozhodnutí majitele z 2026-09-26 do kapitoly „Lišta a úvodní obrazovka"), `README.md` (navigace, kde co najít), `CHANGELOG.md` (Nevydáno: nová navigace, zrušená Kontrola a Banka, obnovení smazaných v tématu).

- [ ] Úpravy; commit `docs: describe the class-first navigation`.

---

## Po dokončení

Celá sada (výchozí i login Playwright na čerstvé `e2e.db`), `pnpm test`, `pnpm typecheck`, `pnpm build`.
