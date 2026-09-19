# Pokyny pro práci na TestMakeru

Nástroj pro učitele základní školy: z výukových materiálů vzniká banka otázek
a z ní tisknutelná písemka. Uživatelkou je učitelka, ne vývojář — chybové hlášky
i texty v rozhraní jsou česky a popisují, co s tím dělat.

## Uspořádání

- `apps/web` — Next.js aplikace (App Router), API, schéma databáze, migrace.
- `packages/core` — doménová logika bez závislosti na Next.js: schémata otázek,
  extrakce textu, prompty pro model, vykreslení PDF. Sem patří všechno, co by
  měl umět použít i budoucí agent nebo CLI.
- `packages/ui` — sdílené React komponenty a design tokeny.

## Design systém

Vzhled celé aplikace drží pohromadě `packages/ui`. Design tokeny (barvy, tvary,
tloušťky) žijí v `packages/ui/src/styles.css` a odtud se importují do webu —
nová barva se nepřidává napřímo v komponentě, ale jako token tady, jinak vzniknou
v aplikaci dvě různá zelená a nikdo nepozná, které je to „správné".

Značková zelená se jmenuje `--color-brand`, ne `accent`. Jméno `accent` patří
shadcn/ui a znamená u něj jen tiché podbarvení plochy při najetí myší — kdo si
ta dvě jména splete, zezelenají mu všechna najetí myší v aplikaci.

Komponenty v `packages/ui/src/ui/` pocházejí z shadcn/ui, ale jakmile jednou
proběhnou přes `shadcn add`, jsou to soubory v tomto repozitáři jako kterékoli
jiné — commitují se, upravují se, nikdo je znovu negeneruje samovolně. Nad nimi
stojí doménové komponenty (`AppShell`, `ThreePane`, `NavList`, `StatRow`,
`ReviewQueue`, `EmptyState`, `QuestionPreview`), které skládají vzhled aplikace
z těchto základních dílů.

Tmavý režim je jen druhá sada hodnot týchž tokenů (`:root.dark` ve stejném
souboru). Komponenty o něm nevědí a nikdy nesmějí mít barvu natvrdo — kdo
napíše `bg-white`, rozsvítí v tmavém režimu bílou díru. Variantu `dark:`
řídí třída na kořenovém elementu, ne nastavení systému, aby ji přepínač
v liště mohl přebít.

Rozhraní rozlišuje dva důrazy podle toho, jestli plocha patří k navigaci/lištám,
nebo k obsahu samotnému: třída `surface-chrome` na navigačních plochách a
`surface-content` na obsahových. Nad svou oblastí přepisují sílu popisků a
poloměr rohů; komponenty samy o důrazu nevědí a vždy sahají po týchž
proměnných (`--label-weight`, `--text-strong` apod.), takže stačí obalit
plochu správnou třídou.

Po každém dalším spuštění `pnpm dlx shadcn add …` v `packages/ui` je nutná
ruční oprava: CLI generuje importy s aliasem `@/…` (např. `from "@/ui/button"`,
`from "cn"`), ale tenhle alias se v `apps/web` rozřeší proti aplikaci, ne proti
balíčku — `packages/ui` se totiž do Next.js vtahuje přes `transpilePackages`,
takže `@/*` z jeho zdrojáků čte cesty `apps/web/src/*`. Po každém přidání
komponenty proto přepiš `from "@/ui/<název>"` na `from "./<název>"` a
`from "cn"` na `from "../cn"` (naše vlastní implementace nad `clsx` a
`tailwind-merge`) a ověř `grep -rn 'from "@/'` a `grep -rn 'from "cn"'` v
`packages/ui/src/ui/`, že nic nezbylo.

## Pravidla

**Jazyk.** Kód, komentáře, commity a dokumentace anglicky nejsou — projekt je
celý česky včetně komentářů, protože ho čte jeho majitel. Commity se píší
anglicky podle Conventional Commits.

**Schémata.** Tvar otázky, šablony i testu určuje zod v `packages/core/src/schema`.
Databáze i model se řídí týmž schématem; nikde se nezavádí druhá definice téhož.

**Šablony jsou data.** PDF vykresluje jeden generický renderer řízený
`TemplateConfig`. Nový vzhled se přidává jako nastavení, ne jako nová komponenta.

**Vykreslení PDF patří do core.** `renderTestToBuffer` v `packages/core/src/pdf/node.ts`
provádí registraci fontů i render nad touž instancí `@react-pdf/renderer`.
Volat `renderToBuffer` z aplikace znamená druhou instanci a nenačtené fonty.

**Extrakce textu běží v prohlížeči.** Na server se posílá jen text. Nikdy
neposílej originální soubory — jsou velké a limit požadavku na Vercelu je 4,5 MB.

**Generuje se ze skupiny, ne ze souboru.** Vstupem generování je téma se všemi
svými materiály. Materiál označený jako duplicitní obsah se vynechává.

**Bez API klíče se nepadá.** Když generování není nakonfigurované, rozhraní ho
skryje a vysvětlí proč.

**Každý dotaz má rozsah.** Funkce v `apps/web/src/lib/*` berou jako první
parametr `Scope` (škola, uživatel, role) z `lib/uzivatel.ts` a doplňují ho do
podmínky (`skola()`, `vlastni()`, `viditelnyTest()`). Knihovna a banka jsou
společné pro školu, písemky a hlavolamy patří své autorce. Cizí věc se tváří
jako neexistující — vrací se `null` a 404, ne 403; z odpovědi nemá být poznat,
že vůbec je. Kontrola v `proxy.ts` je jen hrubé síto podle role, ne
bezpečnostní hranice: rozhoduje se vždycky až nad databází.

**Do brány se nesmí databáze.** `src/proxy.ts` běží v Edge runtime a smí
importovat jedině `lib/session.ts`, který sám nesahá na `@/db` ani na
`node:crypto`. Hlídá to `test/modul-proxy.test.ts`; hesla patří do
`lib/heslo.ts`, který běží jen v Node.

## Ověřování

```bash
pnpm test        # testy v packages/core
pnpm typecheck
pnpm build
```

**Ruční ověřování nikdy nesahá na ostrou databázi.** Server na portu 3000 běží nad
`apps/web/local.db`, kde jsou skutečné materiály a otázky majitelovy manželky.
Pomocné skripty ani zkoušky v prohlížeči proti němu nespouštěj — dřívější běhy
tam nechaly devětadvacet zkušebních testů a jeden běh smazal dva skutečné
předměty. Vše ověřuj proti testovacímu serveru (port 3100, `apps/web/e2e.db`),
který si Playwright spustí sám.

Testy v prohlížeči (`cd apps/web && pnpm exec playwright test`) běží proti
vlastní databázi `apps/web/e2e.db` a vlastnímu serveru na portu 3100, nikdy
proti ostré `local.db`; databázi staví `apps/web/scripts/seed-e2e.ts`
(`pnpm --filter @testmaker/web e2e:db`, sama se postaví, když soubor chybí).

Testy extraktorů a rozpoznávání duplicit používají skutečné soubory ve složce
`sources/`. Ta není v gitu; bez ní se tyto testy přeskočí.

Změny ve vykreslení PDF ověřuj na vygenerovaném souboru, ne jen podle typů:

```bash
cd packages/core && RENDER_SAMPLES=1 pnpm exec vitest run test/render-samples.test.ts
```

Ukázky se uloží do `packages/core/test/tmp`.

## Čeho si všímat

- `sources/` má přes gigabajt a do gitu nepatří.
- Názvy souborů z macOS jsou v rozloženém tvaru a některé jsou poškozené ze
  ZIPu; obojí řeší `normalizePath` v `packages/core/src/extract/paths.ts`.
- Složky `~BROMIUM` obsahují jen několikasetbajtové zástupné soubory s příponou
  `.pdf`, ne skutečné dokumenty.
