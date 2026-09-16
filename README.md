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

### Víc modelů pro generování

Bezplatným tarifům dochází denní limit — a když se to stane uprostřed
generování celého ročníku, nemá smysl, aby zbytek spadl. Do `.env.local` proto
jde napsat žebříček modelů: seznam oddělený čárkami, ve kterém se pokračuje,
když modelu dojde limit nebo je přetížený.

```bash
AI_MODELS=google:gemini-flash-latest,google:gemini-flash-lite-latest
```

Položka může určit i poskytovatele (`google:`, `anthropic:`, `ollama:`), takže
jde míchat Gemini a Claude; bez dvojtečky patří model poskytovateli podle
`AI_PROVIDER`. Bez `AI_MODELS` se použije jediný model podle `AI_PROVIDER`
a `AI_MODEL` — přesně jako dřív. Placený model se zapojí jedině tím, že ho do
žebříčku sám napíšeš; nic se na placeného poskytovatele nepřepne samo.

Přepíná se po dávce, ne po tématu: otázky, které už jsou uložené, zůstávají
a zbytek tématu dogeneruje další model v pořadí. Vyčerpaný model se do konce
běhu přeskakuje, aby se na něj nenaráželo u každé další dávky. U chyby, která
není na opakování (chybný klíč, zrušený model), se další model nezkouší.
Když dojde celý žebříček, generování skončí českou hláškou od posledního
modelu a to, co do té chvíle vzniklo, zůstává v tématu.

Kvalita se mezi modely liší, proto je v hlášce po doběhnutí vidět, když se
v jednom tématu modely míchaly. Hromadné generování bere žebříček z prostředí,
nebo z přepínače:

```bash
pnpm --filter @testmaker/web generate:bulk -- --all --target 10 \
  --models google:gemini-flash-latest,google:gemini-flash-lite-latest
```

Generování otázek běží v pozadí — fronta se zpracuje, dokud je aplikace otevřená
v prohlížeči. Plánovač na Vercelu nepoužíváme: bezplatný tarif (Hobby) pouští cron
nejvýš jednou denně, a rozvrh po minutě v `vercel.json` shodí build. Hromadné
generování proto běží u majitele na počítači:

```bash
pnpm --filter @testmaker/web generate:bulk
```

Při self-hostingu (Synology apod.) můžete frontu pohánět naplánovaným příkazem;
endpoint pouští dovnitř sdílené tajemství `CRON_SECRET`:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<adresa>/api/jobs/run
```

Má-li aplikace běžet vystavená (ne jen lokálně), doplň vedle `ANTHROPIC_API_KEY`
i `APP_PASSWORD` a `AUTH_SECRET` — zapnou přihlášení jedním sdíleným heslem.
Lokálně (`pnpm dev`) se bez `APP_PASSWORD` běží bez přihlášení; v nasazení na
Vercelu se ale aplikace bez hesla neotevře nikomu a odpoví 503 s vysvětlením,
co doplnit, aby se veřejná adresa omylem nespustila dokořán.

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

Projekt cílí na Vercel (bezplatný tarif Hobby). Ve Vercelu nastav proměnné
prostředí:

| Proměnná | K čemu |
| --- | --- |
| `DATABASE_URL` | Turso, `libsql://…` |
| `DATABASE_AUTH_TOKEN` | token k Tursu |
| `APP_PASSWORD` | heslo do aplikace; bez něj se nasazení neotevře |
| `AUTH_SECRET` | podpis přihlašovací cookie, `openssl rand -hex 32` |

Generování otázek zatím běží lokálně, proto `ANTHROPIC_API_KEY` v nasazení
nastavený být nemusí; `CRON_SECRET` taky ne, plánovač na Hobby tarifu neběží.

Schéma databáze i vestavěné šablony vyřídí po každém pushi do `main` workflow
[`.github/workflows/migrate.yml`](.github/workflows/migrate.yml) (migrace
a `pnpm db:seed`). Potřebuje tajemství `TURSO_DATABASE_URL` a `TURSO_AUTH_TOKEN`
v nastavení repozitáře.

Co je v plánu dál, popisuje [ROADMAP.md](ROADMAP.md). Historie změn je
v [CHANGELOG.md](CHANGELOG.md).
