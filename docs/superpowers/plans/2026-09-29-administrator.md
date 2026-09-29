# Administrátor nad školami — plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Role `administrator`, která zakládá a upravuje školy, přepíná se mezi nimi v liště a v každé má plná práva včetně soukromých písemek; správce upraví vlastní školu.

**Architecture:** Vybraná škola se ukládá k účtu (`users.active_school_id`). `aktualniUzivatel()` ji u administrátora dosadí do `Scope.schoolId`, takže všechny dotazy dál filtrují podle jedné školy; `vlastni()` a `viditelnyTest()` u administrátora vynechají podmínku na vlastníka. Školy obsluhuje nový modul `lib/skoly.ts`, nad ním `/api/administrace/*`, `/api/sprava/skola` a obrazovky `/administrace` a sekce „Škola" ve `/sprava`.

**Tech Stack:** Next.js App Router, drizzle + libsql, zod, vitest (nad dočasnou SQLite), Playwright (přihlašovací konfigurace, port 3101, `e2e-login.db`).

**Spec:** `docs/superpowers/specs/2026-09-29-administrator-design.md`

## Global Constraints

- Texty v rozhraní, komentáře a dokumentace česky; commity anglicky podle Conventional Commits.
- Každá funkce v `apps/web/src/lib/*` bere jako první parametr `Scope`; cizí věc = `null`/404.
- `src/proxy.ts` smí importovat jen `lib/session.ts`; `lib/role.ts` zůstává bez importů.
- Migrace přes `pnpm db:generate` (vznikne i snímek v `drizzle/meta`); po ní další `db:generate` nehlásí změnu.
- Roli `administrator` přiděluje jen `scripts/uzivatel.ts`; v rozhraní se nenabízí a API ji odmítne (400 „Tuhle roli v aplikaci přidělit nejde.").
- Nic se nespouští proti `apps/web/local.db` ani portu 3000.
- Nové barvy jen jako tokeny v `packages/ui/src/styles.css`; žádné natvrdo zapsané barvy.

## Review Focus

1. Administrátor přepnutý do cizí školy vytvoří písemku — musí dostat `school_id` vybrané školy, ne domovské.
2. Vybraná škola přestane existovat (nebo je v `active_school_id` nesmysl) — tichý návrat do domovské, žádná chyba 500.
3. Správce pošle přímým voláním API `role: 'administrator'` nebo upraví administrátorský účet — odmítnuto.
4. Doména s velkými písmeny, `@` nebo mezerami a prázdný řetězec — uloží se normalizovaně, prázdná jako `NULL`, dvě školy bez domény nekolidují.
5. Rozpracovaná slova hlavolamu (`puzzleWordDrafts`) zůstávají čistě osobní i pro administrátora — jinak by si přepisoval cizí koncepty.

---

### Task 1: Role a brána

**Files:**
- Modify: `apps/web/src/lib/role.ts`
- Modify: `apps/web/src/lib/session.ts` (`maPravo`)
- Test: `apps/web/test/session.test.ts`, `apps/web/test/proxy.test.ts`

**Interfaces — Produces:**
- `type Role = 'ucitelka' | 'spravce' | 'nahled' | 'administrator'`
- `ROLES` (všechny čtyři), `ROLES_PRIDELITELNE: readonly Role[] = ['ucitelka','spravce','nahled']`
- `ROLE_SPRAVY: Role[] = ['spravce','administrator']`
- `roleMuzeSpravovat(role)` → true pro `spravce` i `administrator`
- `roleJeAdministrator(role)` → true jen pro `administrator`

- [ ] **Step 1: Failing test** v `test/session.test.ts`:

```ts
describe('maPravo pro administraci', () => {
  const relace = (role: Role) => ({ v: 1 as const, uid: 'u', sch: 's', sid: 'r', role, sv: 1, exp: Date.now() + 1000 })
  it('do správy smí správce i administrátor', () => {
    expect(maPravo(relace('spravce'), '/sprava', 'GET')).toBe(true)
    expect(maPravo(relace('administrator'), '/api/sprava/skola', 'PATCH')).toBe(true)
    expect(maPravo(relace('ucitelka'), '/sprava', 'GET')).toBe(false)
  })
  it('do administrace smí jen administrátor', () => {
    expect(maPravo(relace('administrator'), '/administrace', 'GET')).toBe(true)
    expect(maPravo(relace('spravce'), '/administrace', 'GET')).toBe(false)
    expect(maPravo(relace('spravce'), '/api/administrace/skoly', 'POST')).toBe(false)
  })
})
```

- [ ] **Step 2:** `cd apps/web && pnpm exec vitest run test/session.test.ts` → FAIL (typ role / false).
- [ ] **Step 3: Implementace** — v `role.ts` rozšířit typ, popisek `administrator: 'Administrátor'`, přidat konstanty a funkce výše. V `maPravo`:

```ts
if (jeCesta(pathname, '/administrace') || pathname.startsWith('/api/administrace/')) {
  return roleJeAdministrator(relace.role)
}
if (jeCesta(pathname, '/sprava') || pathname.startsWith('/api/sprava/')) {
  return roleMuzeSpravovat(relace.role)
}
```

(`jeCesta(p, base)` = `p === base || p.startsWith(base + '/')`; `session.ts` importuje z `./role` — hodnotový import je v pořádku, `role.ts` nic neimportuje.)
- [ ] **Step 4:** test PASS, `pnpm exec vitest run test/proxy.test.ts test/modul-proxy.test.ts` PASS.
- [ ] **Step 5:** commit `feat(auth): add administrator role`.

### Task 2: Schéma — vybraná škola a unikátní doména

**Files:**
- Modify: `apps/web/src/db/schema.ts` (`users.activeSchoolId`, unikátní index `schools_google_domain_idx`)
- Create: `apps/web/drizzle/0020_administrator.sql` + snímek (vygeneruje `pnpm db:generate --name administrator`)

- [ ] **Step 1:** do `users` přidat

```ts
/** Škola, do které se administrátor přepnul; prázdné = domovská. Ostatní role ji nemají. */
activeSchoolId: text('active_school_id').references((): AnySQLiteColumn => schools.id, { onDelete: 'set null' }),
```

a do `schools` indexů `uniqueIndex('schools_google_domain_idx').on(table.googleDomain)`.
- [ ] **Step 2:** `cd apps/web && pnpm exec drizzle-kit generate --name administrator`; zkontrolovat SQL (ALTER TABLE users ADD active_school_id…, CREATE UNIQUE INDEX…). Unikátní index nad existující `local.db`/Tursem projde jen bez duplicit — dnes má doménu nejvýš jedna škola.
- [ ] **Step 3:** znovu `pnpm exec drizzle-kit generate` → „No schema changes".
- [ ] **Step 4:** `pnpm exec vitest run test/rozsah.test.ts` (migrace v setupu projdou).
- [ ] **Step 5:** commit `feat(db): store administrator's active school`.

### Task 3: Rozsah administrátora

**Files:**
- Modify: `apps/web/src/lib/uzivatel.ts` (`Prihlaseny.domovskaSkolaId`, `aktualniUzivatel`, `vychoziUzivatel`, `vlastni`, `viditelnyTest`)
- Modify: `apps/web/src/lib/puzzles.ts:95` (koncepty jen vlastní)
- Modify: `apps/web/test/helpers.ts` (`seedUcet` přijme `administrator`, `UCET.domovskaSkolaId`)
- Test: `apps/web/test/administrator-rozsah.test.ts`

**Interfaces — Produces:** `Prihlaseny.domovskaSkolaId: string`; `export function skolaUctu(ucet: { role: Role; schoolId: string; activeSchoolId: string | null }, existuje: boolean): string`.

- [ ] **Step 1: Failing test** — administrátor s `activeSchoolId` na druhou školu: `aktualniUzivatel()` (přes `vi.stubEnv('E2E_UZIVATEL', id)`) vrátí `schoolId` druhé školy a `domovskaSkolaId` domovské; `loadTest` najde soukromou písemku učitelky druhé školy; nenajde písemku třetí školy; se smazanou školou vrátí domovskou; `insertTest`/`saveTest` pod jeho scope uloží `school_id` vybrané školy.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementace** — do výběru řádku přidat `activeSchoolId: users.activeSchoolId`; po načtení:

```ts
async function vybranaSkola(row: { role: Role; schoolId: string; activeSchoolId: string | null }) {
  if (!roleJeAdministrator(row.role) || !row.activeSchoolId || row.activeSchoolId === row.schoolId) {
    return null
  }
  const [skola] = await db.select({ id: schools.id, name: schools.name }).from(schools)
    .where(eq(schools.id, row.activeSchoolId)).limit(1)
  return skola ?? null
}
```

a vrátit `{ ...row, schoolId: vybrana?.id ?? row.schoolId, skola: vybrana?.name ?? row.skola, domovskaSkolaId: row.schoolId }`. Totéž ve `vychoziUzivatel`. `vlastni` / `viditelnyTest`:

```ts
if (roleJeAdministrator(scope.role)) return eq(tabulka.schoolId, scope.schoolId)
```

V `puzzles.ts` koncepty: `and(skola(scope, puzzleWordDrafts), eq(puzzleWordDrafts.ownerId, scope.userId), …)`.
- [ ] **Step 4:** PASS + `pnpm exec vitest run test/rozsah.test.ts test/puzzle-words-api.test.ts`.
- [ ] **Step 5:** commit `feat(auth): let administrator work inside any school`.

### Task 4: Místa vyhrazená správci pustí administrátora

**Files:** `src/app/sprava/page.tsx`, `src/app/zaloha/page.tsx`, `src/app/api/prompt-rules/route.ts`, `src/app/api/library/route.ts:125`, `src/app/api/export/route.ts`, `src/app/api/sprava/uzivatele/route.ts`, `src/components/MainNav.tsx`, `scripts/generate-bulk.ts:80` (beze změny — hledá správce), `scripts/uzivatel.ts`.
Test: `apps/web/test/uzivatele-api.test.ts`.

- [ ] **Step 1: Failing test** v `uzivatele-api.test.ts`: `POST` s `role: 'administrator'` → 400 s hláškou „Tuhle roli v aplikaci přidělit nejde."; `PATCH` role na `administrator` → 400; `PATCH` účtu, který je administrátor (jméno/heslo/stav) → 403 „Administrátorský účet se mění jen skriptem."
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `{ role: ['spravce'] }` → `{ role: ROLE_SPRAVY }`; `ucet.role !== 'spravce'` → `!roleMuzeSpravovat(ucet.role)`; `roleSchema` v route z `ROLES_PRIDELITELNE`, ale s `superRefine`, aby šlo vrátit vlastní hlášku; v `PATCH` po nalezení `cil` kontrola `roleJeAdministrator(cil.role)`. V `MainNav` `roleMuzeSpravovat(ucet.role)`. V `SpravaScreen` nabídky rolí z `ROLES_PRIDELITELNE`, řádek administrátora bez ovládacích prvků, jen štítek. Ve `scripts/uzivatel.ts` přidat `administrator` do `ROLE` a po změně role zavolat `odvolatVsechnyRelaceBezRelace`.
- [ ] **Step 4:** PASS celé `pnpm exec vitest run`.
- [ ] **Step 5:** commit `feat(sprava): open school administration to administrator`.

### Task 5: Školy — knihovna a API

**Files:**
- Create: `apps/web/src/lib/skoly.ts`
- Create: `apps/web/src/app/api/sprava/skola/route.ts` (PATCH)
- Create: `apps/web/src/app/api/administrace/skoly/route.ts` (GET, POST, PATCH)
- Create: `apps/web/src/app/api/administrace/skola/route.ts` (POST = přepnout)
- Modify: `apps/web/src/db/seed.ts` (šablony přes `nasaditSablony`)
- Modify: `apps/web/src/lib/uzivatel.ts` (`zapsatAudit` přidá příznak)
- Test: `apps/web/test/skoly.test.ts`

**Interfaces — Produces (`lib/skoly.ts`):**
- `normalizovatDomenu(vstup: string | null | undefined): string | null`
- `nasaditSablony(databaze, schoolId: string): Promise<void>` (idempotentní, stejné id `builtin-<slug>` pro výchozí školu; pro ostatní `builtin-<slug>-<schoolId>`)
- `seznamSkol(scope): Promise<SkolaRadek[] | null>` (null, když scope není administrátor)
- `zalozitSkolu(scope, { name, googleDomain?, googleAutoJoin? }): Promise<{ id } | { chyba, status }>`
- `upravitSkolu(scope, schoolId, zmeny): Promise<{ ok: true } | { chyba, status }>` — správce smí jen `scope.schoolId`, administrátor kteroukoli
- `prepnoutSkolu(scope: Prihlaseny, schoolId): Promise<boolean>`
- `SkolaRadek = { id, name, slug, googleDomain, googleAutoJoin, pocetUctu }`

- [ ] **Step 1: Failing testy:** normalizace (`' @Skola.CZ '` → `'skola.cz'`, `''` → `null`); správce upraví vlastní školu, cizí → 404; obsazená doména → 409 „Doména skola.cz už patří škole X. Nejdřív ji tam odeberte."; prázdný název → 400 „Škola musí mít název."; administrátor založí školu a ta má všechny `BUILT_IN_TEMPLATES`; slug při kolizi dostane příponu; `GET /api/administrace/skoly` pro správce 404; přepnutí na neexistující → 404; přepnutí zapíše `active_school_id` a událost `administrator-prepnul-skolu` s `detail.administrator === true`; `zapsatAudit` přidá příznak jen mimo domovskou školu.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementace podle rozhraní; route handlery přes `sRozsahem(..., { role: ROLE_SPRAVY })` resp. `{ role: ['administrator'] }`, ale odmítnutí role u administrace přeložit na 404 (vlastní kontrola `roleJeAdministrator` před `sRozsahem`-handlerem, vrací 404). V `zapsatAudit`:

```ts
const detail = await sPriznakemAdministratora(zaznam)
```

(dotaz na `users.role, users.schoolId` podle `zaznam.userId`; když administrátor a `schoolId !== zaznam.schoolId`, `{ ...(detail ?? {}), administrator: true }`).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(skoly): create, edit and switch schools`.

### Task 6: Rozhraní

**Files:**
- Create: `apps/web/src/components/SkolaPrepinac.tsx`
- Modify: `apps/web/src/components/MainNav.tsx`, `apps/web/src/app/layout.tsx` (+ `AppChrome` typ `ucet`)
- Create: `apps/web/src/app/administrace/page.tsx`, `apps/web/src/app/administrace/AdministraceScreen.tsx`
- Modify: `apps/web/src/app/sprava/page.tsx`, `apps/web/src/app/sprava/SpravaScreen.tsx` (sekce „Škola", štítek „Administrátor" u událostí)

- [ ] **Step 1:** `layout.tsx` předá `ucet.skola`, `ucet.cizi = schoolId !== domovskaSkolaId` a pro administrátora seznam škol (`seznamSkol`). `SkolaPrepinac` = `DropdownMenu` s názvem školy, štítkem „Cizí škola", položkami škol (`POST /api/administrace/skola`, pak `router.push('/')` a `router.refresh()`) a odkazem „Administrace".
- [ ] **Step 2:** `/administrace`: seznam škol (Card řádky), formulář „Nová škola" (název, doména, automatické přiřazení), úprava inline, tlačítko „Přepnout sem".
- [ ] **Step 3:** `/sprava`: karta „Škola" v záložce Účty — název, doména, přepínač automatického přiřazení (`Switch`/checkbox z `packages/ui`), `PATCH /api/sprava/skola`.
- [ ] **Step 4:** `pnpm typecheck`, `pnpm build`.
- [ ] **Step 5:** commit `feat(ui): school switcher, administration page and school settings`.

### Task 7: E2E

**Files:**
- Modify: `apps/web/scripts/seed-e2e.ts` (druhá škola `skola-druha` s učitelkou `ucitelka.c@localhost`, správcem `spravce.b@localhost` a soukromou písemkou „Soukromá písemka C"; administrátor `admin@localhost` v `skola-vyvoj`)
- Modify: `apps/web/playwright.login.config.ts` (`UCTY` + `administrace\.spec\.ts` v `testMatch`)
- Create: `apps/web/e2e/administrace.spec.ts`

- [ ] **Step 1:** scénáře ze specu: administrátor přepne a vidí soukromou písemku; správce B vidí přepnutí se štítkem; administrátor založí školu; správce upraví svou školu, `/administrace` ho vrátí na `/`, nabídka rolí nemá „Administrátor"; učitelka A nevidí písemku C.
- [ ] **Step 2:** `cd apps/web && rm -f e2e-login.db && pnpm exec playwright test -c playwright.login.config.ts` PASS.
- [ ] **Step 3:** commit `test(e2e): administrator across schools`.

### Task 8: Dokumentace a ověření

- [ ] README: role administrátora, `--role administrator`, `/administrace`.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm build`, `cd apps/web && pnpm exec drizzle-kit generate` bez změny.
- [ ] commit `docs: administrator role`, push.
