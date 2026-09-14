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

## Ověřování

```bash
pnpm test        # testy v packages/core
pnpm typecheck
pnpm build
```

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
