# Administrátor nad školami

Datum: 2026-09-29

## Proč

Dnes všechno končí na hranici jedné školy. Správce spravuje účty své školy,
ale školu samotnou (název, doménu Google, automatické přiřazení) upravit nejde
jinak než SQL příkazem v Tursu, a novou školu nezaloží nikdo. Majitel aplikace
chce roli nad školami: zakládá je, nastavuje a smí do kterékoli z nich vstoupit
s plnými právy, včetně soukromých písemek a hlavolamů učitelek.

Zároveň má správce dostat možnost upravit vlastní školu, aby běžné nastavení
nemuselo jít přes administrátora.

## Co platí dál

- Knihovna a banka jsou společné pro školu, písemky a hlavolamy patří autorce.
- Každý dotaz v `apps/web/src/lib/*` bere `Scope` a filtruje podle jedné školy.
  Data dvou škol se v jednom výsledku nikdy nesmíchají — ani u administrátora.
- Cizí věc se tváří jako neexistující: `null` a 404, ne 403.
- `proxy.ts` je jen hrubé síto podle role; rozhoduje se nad databází.

## Role

Do `Role` v `src/lib/role.ts` přibude `administrator` (popisek „Administrátor").
Sloupec `users.role` je text, migraci nepotřebuje.

| Role | Obsah vybrané školy | Soukromé písemky kolegyň | Účty školy | Úprava vlastní školy | Jiné školy |
|---|---|---|---|---|---|
| `nahled` | čte | ne | ne | ne | ne |
| `ucitelka` | čte i mění | ne | ne | ne | ne |
| `spravce` | čte i mění | ne | ano | ano | ne |
| `administrator` | čte i mění | ano | ano | ano | ano (přepnutím) |

Roli `administrator` přiděluje **jen** skript `scripts/uzivatel.ts`
(`--role administrator`). V rozhraní ji nikdo nepřidělí ani neodebere, takže
uniklý účet správce se na administrátora nepovýší. Správce administrátorský
účet ve své škole vidí, ale nemůže ho měnit.

`roleMuzeSpravovat()` vrací `true` pro `spravce` i `administrator`. Nová
`roleJeAdministrator()` jen pro `administrator`. Místa s natvrdo zapsaným
`role === 'spravce'` (lišta v `MainNav.tsx`, `maPravo` v `session.ts`) přejdou
na tyto funkce.

## Data a relace

**Domovská škola zůstává.** Administrátor je dál účet jedné školy
(`users.school_id` je `NOT NULL` a ukazují na něj cizí klíče). Do ostatních
škol se přepíná.

**Vybraná škola u účtu.** Tabulka `users` dostane sloupec
`active_school_id` (text, nullable, cizí klíč na `schools.id`,
`on delete set null`). Prázdný znamená domovskou školu. Volba se ukládá
k účtu, ne k relaci: funguje tak stejně i bez přihlašování (lokální běh,
testy), cookie se nemusí převydávat a pole `sch` v ní dál nese domovskou
školu, kterou nikdo nečte. Přepnutí na jednom zařízení platí i na ostatních —
u jednoho či dvou administrátorů to nevadí. Migrace vznikne přes
`pnpm db:generate`, takže dostane i snímek v `apps/web/drizzle/meta`.

**`aktualniUzivatel()`** (i výchozí účet bez přihlašování) u administrátora
vezme školu z `users.active_school_id`, u ostatních rolí z `users.school_id`.
Když vybraná škola neexistuje, použije se domovská. Do `Prihlaseny` přibude
`domovskaSkolaId`, aby lišta poznala cizí školu.

**Změna role skriptem** odhlásí účet ze všech zařízení: role se nese
v podepsané cookie a brána by jinak do odhlášení pouštěla podle staré.

**Rozsah.** Tvar `Scope` se nemění: `schoolId` je vybraná škola, `role` je
`administrator`.

- `skola()` beze změny.
- `vlastni()` a `viditelnyTest()` u administrátora vynechají podmínku na
  vlastníka a viditelnost; podmínka na školu zůstává.
- Co administrátor ve vybrané škole vytvoří, dostane `school_id` vybrané školy
  a `owner_id` administrátora.

**Doména je unikátní.** Na `schools.google_domain` přibude unikátní index.
SQLite dovolí víc `NULL`; prázdný řetězec se před uložením převede na `NULL`,
doména se ukládá malými písmeny bez `@` a mezer. Bez unikátnosti by přihlášení
Googlem nevědělo, do které školy učitelku zařadit.

## Rozhraní

### Přepínač školy v liště

Jen pro administrátora, v `MainNav.tsx` ve slotu `status` před `UserMenu`.
Ukazuje název vybrané školy; rozbalí se na seznam všech škol a odkaz
„Administrace". Když vybraná škola není domovská, svítí u názvu štítek
„Cizí škola".

Volba pošle `POST /api/administrace/skola` s `{ schoolId }`. Server zapíše
`users.active_school_id`, zapíše událost a klient přejde na `/` a obnoví
stránku, protože otevřená stránka (téma, písemka) ve druhé škole neexistuje.

### `/administrace`

Jen administrátor. Stránka `src/app/administrace/page.tsx`, API pod
`src/app/api/administrace/`.

- Seznam škol: název, doména, automatické přiřazení, počet účtů, odkaz
  „Přepnout sem".
- Založit školu: název (povinný); slug se odvodí z názvu a při kolizi dostane
  číselnou příponu. Nová škola rovnou dostane vestavěné šablony
  (`BUILT_IN_TEMPLATES`, stejná logika jako `db/seed.ts` — vytáhne se do
  sdílené funkce), jinak by v ní nešlo uložit písemku.
- Upravit školu: název, doména Google, automatické přiřazení.
- Mazání škol v rozhraní není.

Účty libovolné školy spravuje administrátor přes `/sprava` po přepnutí do ní;
druhá obrazovka účtů nevzniká.

### `/sprava`

Pro správce i administrátora, vždy nad vybranou školou.

- Nová sekce „Škola": název, doména Google, automatické přiřazení
  (`PATCH /api/sprava/skola`). Dnešní text o doméně se nahradí formulářem.
- Nabídka rolí u účtů obsahuje `ucitelka`, `spravce`, `nahled`, nikdy
  `administrator`. Řádek administrátorského účtu je jen ke čtení.

### Oprávnění v bráně

`maPravo` v `src/lib/session.ts`:

- `/sprava`, `/api/sprava/*` — `spravce` a `administrator`.
- `/administrace`, `/api/administrace/*` — jen `administrator`.

Každý endpoint si roli ověří znovu ze `Scope` nad databází. Brána odmítne
cizí roli na `/api/administrace/*` stejně jako dnes na `/api/sprava/*`
(403, stránka přesměruje na `/`); samotný handler vrací 404.

`/zaloha`, export a obnova knihovny a pravidla promptu, dnes vyhrazené
správci, pustí i administrátora.

## Záznam událostí

Přes stávající `zapsatAudit`:

| Akce | Škola záznamu | Kdy |
|---|---|---|
| `administrator-prepnul-skolu` | cílová | přepnutí v liště |
| `skola-zalozena` | nová | založení v `/administrace` |
| `skola-upravena` | upravená | úprava v `/administrace` nebo `/sprava` |

`zapsatAudit` sám pozná, že událost zapisuje administrátor mimo svou
domovskou školu, a přidá do `detail` příznak `administrator: true`. Platí to
pro všechny události, které se dnes zapisují (účty, přihlášení, záloha…).
Úpravy obsahu (písemky, otázky) se dnes do záznamu nepíšou a tahle změna to
nemění. Záznam v `/sprava` událost s příznakem ukáže štítkem
„Administrátor", aby správce školy viděl, kdo na co sáhl.
Čtení se nezapisuje.

## Chybové stavy

Hlášky česky a s tím, co dělat:

- Přepnutí na neexistující školu — 404 „Škola se nenašla.", zůstává původní.
- Vybraná škola mezitím zmizela — tichý návrat do domovské.
- Obsazená doména — „Doména skola.cz už patří škole X. Nejdřív ji tam
  odeberte."
- Prázdný název školy — „Škola musí mít název."
- Správce se pokusí přidělit nebo odebrat `administrator` přímým voláním API —
  400 „Tuhle roli v aplikaci přidělit nejde."

## Testy

**Unit** (`apps/web/test`):

- `vlastni()` a `viditelnyTest()` pro administrátora (cizí soukromá písemka ve
  vybrané škole ano, v jiné škole ne) a pro ostatní role beze změny.
- `maPravo` pro `/sprava` a `/administrace` podle rolí.
- Výběr školy v `aktualniUzivatel` včetně zmizelé školy.
- Normalizace a unikátnost domény.

**E2E** (přihlašovací konfigurace `playwright.login.config.ts`, port 3100,
`e2e.db`). `scripts/seed-e2e.ts` dostane druhou školu s učitelkou, soukromou
písemkou a správcem a jednoho administrátora.

- Administrátor přepne do druhé školy a vidí soukromou písemku tamní
  učitelky; správce druhé školy vidí přepnutí v záznamu se štítkem.
- Administrátor založí školu, ta má vestavěné šablony a jde v ní uložit
  písemka.
- Správce upraví název a doménu své školy; na `/administrace` dostane 404;
  v nabídce rolí `administrator` nemá.
- Učitelka první školy nevidí nic z druhé.

Na konci `pnpm test`, `pnpm typecheck`, `pnpm build` a `pnpm db:generate`
bez hlášené změny.

## Mimo rozsah

- Mazání škol.
- Přesun účtu mezi školami.
- Víc domén pro jednu školu.
- Přidělování role `administrator` v rozhraní.
