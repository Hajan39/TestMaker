# TestMaker

Nástroj pro učitele: z výukových materiálů vytvoří banku otázek a poskládá z nich
písemku do PDF na A4.

Postup je vždy stejný: naimportuj složku s materiály → nech si vygenerovat otázky
→ projdi je a schval → poskládej test → stáhni PDF.

## Co umí

- **Import celé složky.** Text z PDF, prezentací (ODP), dokumentů (ODT, DOCX),
  HTML i prostého textu se vytáhne přímo v prohlížeči. Na server jde jen text,
  ne soubory, takže velikost ani počet nevadí. Struktura složek se použije jako
  Předmět → Ročník → Téma.
- **Skupiny materiálů.** Soubory patřící k téže lekci se spojí do jedné skupiny
  a otázky se generují ze všech naráz — jeden soubor na písemku obvykle nestačí.
  Skupinu lze přejmenovat, sloučit s jinou nebo z ní soubor vyjmout.
- **Rozpoznání téhož obsahu.** PDF vytištěné z prezentace nese stejný text jako
  ta prezentace; slabší kopie se označí a do generování nevstupuje.
- **Deset typů otázek.** Volná odpověď, krátká odpověď, výběr jedné i více
  možností, pravda/nepravda, doplňování do textu, přiřazování dvojic, řazení,
  doplňovací tabulka a popis obrázku. Učitel může kteroukoli upravit nebo napsat
  vlastní, včetně tabulek jako přílohy otázky.
- **Knihovna ve třech sloupcích.** Předměty a ročníky, témata vybraného
  ročníku a obsah tématu jsou vedle sebe na jedné obrazovce, takže učitelka
  vidí, kde v ročníku je, aniž by se musela proklikávat tam a zpátky.
- **Kontrola vygenerovaných konceptů po jedné.** Místo dlouhého seznamu ke
  schválení jde fronta, která ukáže vždy jednu otázku spolu s úryvkem
  materiálu, ze kterého vznikla, a ovládá se klávesnicí — schválit, zamítnout,
  upravit nebo přeskočit bez sahání po myši. Ke každé vygenerované otázce se
  ukládá i doklad původu: název souboru a citovaná pasáž.
- **Skládání testu napříč knihovnou.** Do jednoho testu jdou otázky z různých
  témat, ročníků i předmětů — hodí se na čtvrtletky a opakování z loňska. Test
  má vlastní strukturu: nadpisy částí, pokyny, zalomení stránky, libovolný počet
  otázek.
- **PDF na A4.** Hlavička se jménem a třídou, body u otázek, klíč správných
  odpovědí a varianty A/B s přeházeným pořadím. Test může být i bez známek —
  pak se body ani políčko na známku netisknou.
- **Šablony jako nastavení.** Vzhled testu je uložený jako data, ne jako kód.
  Náhled šablony je skutečná stránka PDF z téhož rendereru, který dělá i hotový
  test.
- **Náhled testu při skládání.** Osnova testu se skládá přetahováním a hrubý
  náhled stránky se přitom počítá přímo v prohlížeči, takže je hned vidět, kam
  padne zalomení stránky, ještě než se test pošle na vykreslení PDF.

## Rychlý start

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # doplň ANTHROPIC_API_KEY
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Aplikace běží na http://localhost:3000. Materiály naimportuj na stránce
**Import materiálů**, nebo z disku:

```bash
pnpm --filter @testmaker/web import:local ../../sources
```

Bez `ANTHROPIC_API_KEY` aplikace funguje dál, jen se skryje generování otázek.

## Uspořádání

| Balíček | Obsah |
| --- | --- |
| `apps/web` | Next.js aplikace, API, databáze, migrace |
| `packages/core` | Doménová logika: schémata otázek, extrakce textu, prompty, vykreslení PDF |
| `packages/ui` | Sdílené React komponenty a design tokeny |

Doménová logika záměrně nezávisí na Next.js, aby ji mohl použít i pozdější
agent nebo CLI.

## Technologie

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Drizzle ORM nad SQLite
(lokálně soubor, v provozu Turso), Vercel AI SDK s vyměnitelným poskytovatelem
(Claude, případně lokální Ollama), `@react-pdf/renderer` pro PDF.

## Příkazy

| Příkaz | Co dělá |
| --- | --- |
| `pnpm dev` | Vývojový server |
| `pnpm build` | Produkční build |
| `pnpm test` | Testy |
| `pnpm typecheck` | Kontrola typů |
| `pnpm db:migrate` | Migrace databáze |
| `pnpm db:seed` | Vestavěné šablony |
| `pnpm db:studio` | Prohlížeč databáze |

## Nasazení

Projekt cílí na Vercel. Databáze je Turso: nastav `DATABASE_URL`
(`libsql://…`) a `DATABASE_AUTH_TOKEN`. Generování otázek zatím běží lokálně,
proto `ANTHROPIC_API_KEY` v nasazení nastavený být nemusí.

Co je v plánu dál, popisuje [ROADMAP.md](ROADMAP.md). Historie změn je
v [CHANGELOG.md](CHANGELOG.md).
