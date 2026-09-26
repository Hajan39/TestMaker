# Materiály a generování v tématu — plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cíl:** Učitelka nahraje materiály přímo v tématu, u souboru rozhodne, jestli jde do generování, a generuje otázky jednoduchým formulářem (počet + obtížnost). Stránka Import už pro běžnou práci není potřeba.

**Architektura:** `POST /api/materials` dostane nepovinné `topicId` — soubory nahrané z tématu padnou do tohoto tématu bez ohledu na názvy (ověřeno proti škole). Materiál dostane příznak `excluded` (migrace 0016, drizzle-kit se snímkem): vynechaný materiál nejde do generování ani do počtu použitelného textu, stejně jako automaticky poznaný duplikát. Pruh materiálů je přestavěný `TopicGroup` nad sdíleným `Collapsible`, s nahráváním přes existující extrakci v prohlížeči (`extract.worker.ts`, `uploadMaterials`). Generovací formulář ztrácí volbu typů a režim „doplnit na počet".

**Tech stack:** Next.js App Router, React, Drizzle (libsql), zod, Web Worker extrakce z `packages/core/src/extract`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-zjednoduseni-ucitelka-design.md` — „Stránka tématu" → Materiály, Generování; pořadí prací krok 4.

## Globální omezení

- Kód, komentáře, texty česky; commity anglicky (Conventional Commits) zakončené `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Extrakce textu běží v prohlížeči, na server jde jen text, dávky pod 4,5 MB (stávající `uploadMaterials`). Originální soubory nikdy na server.
- Nikdy nesahat na `apps/web/local.db` ani port 3000. Playwright jen přes jeho konfigurace (3100 / login 3101). Migrace nad `local.db` nespouštět.
- Po změně schématu `pnpm db:generate` a ověřit, že hlásí „No schema changes" (viz `CLAUDE.md`).
- Každá funkce v `lib/*` bere `Scope`; cizí téma/materiál → 404/`null`, nic neprozradit.
- Tokeny a `surface-*` třídy, mobil 360 px bez vodorovného posunu.
- Role `nahled`: vidí materiály a otázky, nevidí nahrávání, vynechání, mazání ani generování.
- Do commitů jen vyjmenované soubory (`git add <soubor>`).
- Ověření po úkolu: `pnpm test`, `pnpm typecheck`; u rozhraní i `pnpm build` a dotčené Playwright specy.

## Na co si dát pozor při revizi

1. **Téma se mezitím přejmenuje** — nahrání s `topicId` musí jít do správného tématu, ne vytvořit nové podle starého názvu. Test v úkolu 1.
2. **Vynechaný materiál a generování** — do modelu nejde; když jsou vynechané všechny, tlačítko generování je vypnuté s vysvětlením. Test v úkolu 2 a 4.
3. **Nahrání souboru bez textu / nepodporovaného typu** — učitelka vidí, co se přeskočilo a proč. Test v úkolu 3.
4. **Stejný soubor nahraný podruhé do téhož tématu** — nevznikne dvakrát (stávající deduplikace podle hashe). Test v úkolu 3.
5. **Téma bez materiálů i bez otázek** — výzva s dvěma cestami (nahrát / napsat). Test v úkolu 4.

---

### Úkol 1: Nahrání do konkrétního tématu

**Soubory:** `apps/web/src/app/api/materials/route.ts`, `packages/core/src/schema/material.ts` (`importBatchSchema`), `apps/web/src/lib/importClient.ts` (`uploadMaterials` přijme `topicId?`), test `apps/web/test/materials-api.test.ts`.

**Rozhraní:** tělo `POST /api/materials` = `{ materials: ExtractedMaterial[], topicId?: string }`. Se `topicId`: téma se ověří `skola(scope, topics)` (cizí/neexistující → 404 „Téma se nenašlo"), všechny materiály jdou do něj (pole `subject/grade/topic` se ignorují), deduplikace podle `(topicId, contentHash)` a `linkDuplicates` beze změny. Bez `topicId` chování beze změny. `uploadMaterials(materials, { topicId?, batchSize? })`.

- [ ] Testy (padají): nahrání s `topicId` jde do tématu i po jeho přejmenování (bod revize 1); cizí `topicId` → 404; stejný hash podruhé → nevznikne dvakrát; bez `topicId` beze změny.
- [ ] Implementace; `pnpm test && pnpm typecheck`; `playwright test e2e/import.spec.ts e2e/podklady.spec.ts`.
- [ ] Commit: `feat(materials): upload files straight into a topic`.

---

### Úkol 2: Vynechat materiál z generování

**Soubory:** `apps/web/src/db/schema.ts` (`materials.excluded integer boolean not null default false`), migrace `apps/web/drizzle/0016_material-excluded.sql` + snímek (drizzle-kit), `apps/web/src/app/api/materials/route.ts` (`PATCH { id, excluded }`), `apps/web/src/lib/generation.ts` (`loadTopicSource` vynechá `excluded`), přepočet použitelného textu tématu (najít, kde se počítá `usableCharCount`/`lowContent` — `recomputeTopicContent` nebo obdobná funkce — a vynechat tam i `excluded`), `apps/web/src/lib/questionFile.ts` (zdroj pro Claude Code vynechá `excluded`), testy `apps/web/test/materials-api.test.ts`, `apps/web/test/generate-api.test.ts` nebo `generation-models.test.ts`.

**Rozhraní:** `PATCH /api/materials { id: string, excluded: boolean }` → 200 `{ ok: true }`; cizí materiál → 404; jen role s právem zápisu (`sRozsahem(…, { zapis: true })`). Po změně se přepočte použitelný text tématu.

- [ ] Testy (padají): vynechaný materiál není v `loadTopicSource(...).text` ani v souboru pro Claude Code; `usableCharCount` ho nepočítá; PATCH cizího → 404; `nahled` → 403.
- [ ] Implementace + migrace (bezpečná nad ostrou DB: `ALTER TABLE … ADD … DEFAULT false NOT NULL`); `pnpm db:generate` hlásí žádné změny.
- [ ] `pnpm test && pnpm typecheck`; commit: `feat(materials): leave a file out of generation`.

---

### Úkol 3: Pruh materiálů v tématu

**Soubory:** `apps/web/src/components/TopicGroup.tsx` (přestavba; případně rozdělit na `MaterialsStrip.tsx` + `MaterialRow.tsx`, pokud přesáhne ~250 řádků), `apps/web/src/app/topics/[id]/page.tsx` (předá `excluded`), nový e2e `apps/web/e2e/tema-materialy.spec.ts`, úprava `apps/web/e2e/import.spec.ts` a `podklady.spec.ts`, pokud se změní texty.

Chování:
- Sdílený `Collapsible`; spouštěcí tlačítko dál začíná „Materiály" (drží ho testy `import.spec.ts`/`podklady.spec.ts`), ukazuje počet souborů použitých pro generování a „+N vynechaných" (duplikáty i ručně vynechané). Sbalený, když materiály existují; téma bez materiálů ukazuje rovnou nahrávací plochu.
- Nahoře v obsahu „Nahrát materiály" (vícenásobný výběr souborů + přetažení na pruh). Extrakce v prohlížeči přes `extractAll` / `extract.worker.ts` s ukazatelem průběhu (`Progress`), pak `uploadMaterials(…, { topicId })`, pak `router.refresh()`. Přeskočené a nepovedené soubory se ukážou stručně s důvodem (převzít `SKIP_LABELS`/`IssueList` z `ImportClient.tsx` — vyjmout do sdíleného modulu, ne kopírovat). Hotovo → toast „Nahráno N souborů" (+ „M už v tématu bylo").
- Řádek souboru: název, rozsah textu, štítek „skoro bez textu", poznámka o duplikátu (jako dnes); přepínač „Použít pro generování" (vypnuto = `excluded`), „Smazat" (stávající potvrzení).
- „Upravit téma" (přejmenování, přesun, sloučení, smazání tématu, přesun materiálu) zůstává beze změny.
- Role `nahled`: bez nahrávání, přepínače a mazání.

- [ ] e2e (padá): nahrát 2 soubory (`setInputFiles` s textovými soubory vytvořenými v testu) → objeví se v pruhu; nahrát znovu tentýž → „už v tématu bylo" a nezdvojí se (bod revize 4); nepodporovaný soubor → uvedený mezi přeskočenými (bod revize 3); vypnout „Použít pro generování" → počet v hlavičce pruhu klesne; role `nahled` (login config, `role.spec.ts`) nevidí nahrávání.
- [ ] Implementace; `pnpm test && pnpm typecheck && pnpm build`; `playwright test e2e/tema-materialy.spec.ts e2e/import.spec.ts e2e/podklady.spec.ts e2e/tema-otazky.spec.ts` + login `role.spec.ts`.
- [ ] Commit: `feat(web): manage and upload materials right in the topic`.

---

### Úkol 4: Jednoduché generování a prázdné téma

**Soubory:** `apps/web/src/components/GenerateDialog.tsx`, `apps/web/src/app/topics/[id]/TopicWorkspace.tsx`, `apps/web/src/app/api/generate/route.ts` (výchozí hodnoty), `apps/web/src/lib/generation.ts` (`DEFAULT_GENERATE_PARAMS.count = 10`), e2e `apps/web/e2e/generovani.spec.ts`, `prubeh-generovani.spec.ts`, `tema-otazky.spec.ts`.

Chování:
- Karta generování: tlačítko „Vygenerovat otázky" a vedle dvě pole — „Počet" (výchozí 10, 1–60) a „Obtížnost" (Promíchat / Lehké / Střední / Těžké, výchozí Promíchat). Volba typů a režim „Doplnit na celkový počet" zmizí; aplikace posílá všechny `AI_QUESTION_TYPES` a režim `add`. API `mode`/`types` dál přijímá (fronta a skripty je používají), jen je formulář neposílá.
- Pod tlačítkem stručně: „Vznikne N otázek z X materiálů." Když jsou všechny materiály vynechané nebo žádné nejsou → tlačítko vypnuté a text „Nejdřív nahraj materiál nebo ho zapni pro generování." (bod revize 2).
- Průběh a živě přibývající otázky zůstávají nad seznamem (dnešní `ProgressLine` + `fresh`).
- Téma bez materiálů i bez otázek: místo karty generování a pruhu `EmptyState` „Téma je zatím prázdné." s akcemi „Nahrát materiál" (otevře nahrávání v pruhu) a „Napsat otázku" (otevře „Nová otázka") (bod revize 5).
- Bez nakonfigurovaného modelu: dnešní `AiUnavailable` (beze změny).

- [ ] e2e (padá): `generovani.spec.ts` přepsat na nový formulář (počet, obtížnost, vypnuté tlačítko při vynechaných materiálech); prázdné téma ukazuje výzvu a obě akce fungují; `prubeh-generovani.spec.ts` dál prochází (tvar událostí se nemění).
- [ ] Implementace; `pnpm test && pnpm typecheck && pnpm build`; `playwright test e2e/generovani.spec.ts e2e/prubeh-generovani.spec.ts e2e/tema-otazky.spec.ts e2e/tema-materialy.spec.ts e2e/vyber-a-motiv.spec.ts`.
- [ ] Commit: `feat(web): generate questions with just a count and a difficulty`.

---

## Po dokončení

- Celá sada: `pnpm test`, `pnpm typecheck`, `pnpm build`, Playwright výchozí i login config na čerstvé `e2e.db`.
- Majitel spustí migrace 0014–0016 nad ostrou databází (`cd apps/web && pnpm db:migrate`).
