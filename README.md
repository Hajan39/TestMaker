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

Položka může určit i poskytovatele (`google:`, `anthropic:`, `ollama:`
a služby s rozhraním OpenAI níž), takže jde míchat Gemini a Claude; bez
dvojtečky patří model poskytovateli podle `AI_PROVIDER`. Bez `AI_MODELS` se
použije jediný model podle `AI_PROVIDER` a `AI_MODEL` — přesně jako dřív. Placený model se zapojí jedině tím, že ho do
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

### Jeden klíč na víc modelů

Každý další poskytovatel v žebříčku obvykle znamená další registraci a další
klíč. Služby s rozhraním OpenAI („OpenAI-compatible") to obcházejí: u jedné
z nich si založíš účet jednou a její klíč otevře modely od různých výrobců —
žebříček se pak dá složit z nich. Nejširší nabídku (a nejvíc modelů zdarma) má
OpenRouter.

| Služba | Předpona v `AI_MODELS` | Klíč | Kde ho vzít |
| --- | --- | --- | --- |
| OpenRouter | `openrouter:` | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| Groq | `groq:` | `GROQ_API_KEY` | https://console.groq.com/keys |
| Mistral | `mistral:` | `MISTRAL_API_KEY` | https://console.mistral.ai |
| DeepInfra | `deepinfra:` | `DEEPINFRA_API_KEY` | https://deepinfra.com/dash/api_keys |
| Together | `together:` | `TOGETHER_API_KEY` | https://api.together.ai/settings/api-keys |

Adresu služby psát nemusíš, ke každé je zabudovaná; přebít ji jde proměnnou
`OPENROUTER_BASE_URL` (a obdobně u ostatních). Do `.env.local` tedy stačí klíč
a žebříček — doporučené nastavení pro toho, kdo chce vystačit s jedním klíčem:

```bash
OPENROUTER_API_KEY=sk-or-…
# Modely si vyber v seznamu níž — nabídka bezplatných se u OpenRouteru mění,
# takže tenhle řádek ber jako tvar, ne jako doporučení konkrétních jmen.
AI_MODELS=openrouter:nvidia/nemotron-3.5-lightning:free,openrouter:dots-studio/dots-3-note-preview:free
```

Modely zdarma poznáš podle `:free` na konci názvu. Jejich nabídka se u
OpenRouteru mění (model, který je dnes zdarma, může za měsíc zmizet), takže
než žebříček napíšeš, projdi aktuální seznam na
https://openrouter.ai/models?q=free. Dvojtečka uvnitř názvu modelu ničemu
nevadí — za poskytovatele se bere jen první slovo před dvojtečkou, a jen když
je to název známé služby (stejně jako u `ollama:qwen3:14b`).

Když limit dojde i u posledního modelu žebříčku, generování skončí českou
hláškou o vyčerpaném limitu; otázky, které do té chvíle vznikly, zůstanou
v tématu uložené a druhý den se dá jen spustit generování znovu. Kdyby se
čekat nechtělo, dopiš na konec žebříčku placený model — přepne se na něj jedině
proto, že tam je.

Stejnou cestou jde oslovit i vlastní adresu: model běžící na jiném počítači,
v LM Studiu nebo za vlastní proxy. Klíč je u ní nepovinný, adresa povinná
a model musíš napsat vždycky:

```bash
AI_PROVIDER=custom
AI_MODEL=qwen3-14b
CUSTOM_BASE_URL=http://127.0.0.1:1234/v1
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

## Účty a role

Aplikaci používá sborovna jedné školy. Knihovna (předměty, ročníky, témata,
materiály a otázky) je **společná**; **písemky a hlavolamy patří té, kdo je
vytvořila** — cizí se nezobrazí ani nevytisknou, dokud je autorka nenasdílí.

| Role | Co smí |
| --- | --- |
| `ucitelka` | všechno s obsahem: import, generování, kontrola, testy, hlavolamy |
| `spravce` | navíc účty, zálohy školy, záznam událostí a chyb; jako jediný smí mazat předmět, ročník a téma |
| `nahled` | jen čte a tiskne |

Přihlašování zapíná proměnná `AUTH_SECRET`. Lokálně (`pnpm dev`) se bez ní
běží bez přihlášení pod výchozím účtem ze seedu; v nasazení na Vercelu se
aplikace bez tajemství neotevře nikomu a odpoví 503 s vysvětlením, co doplnit,
aby se veřejná adresa omylem nespustila dokořán.

Účty zakládá správce v sekci **Správa**. Úplně prvního správce (a kdykoli
později odemčení účtu, do kterého se nikdo nedostane) vyřídí skript:

```bash
pnpm --filter @testmaker/web uzivatel -- --email jana@skola.cz --jmeno "Jana" --role spravce
pnpm --filter @testmaker/web uzivatel -- --vypis
```

Heslo se nepíše do příkazu, ale zadává se po spuštění; když se nezadá,
vygeneruje se a vypíše. Nově založený účet si heslo při prvním přihlášení
změní — to, co správce nadiktoval, zná zbytečně někdo druhý.

### Přihlášení přes Google

Učitelé mívají školní účty Google; přihlášení jde zapnout vedle hesla, ne
místo něj. Potřebuje proměnné `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI` a doménu školy (`GOOGLE_HD` nebo sloupec
`schools.google_domain`). Bez `GOOGLE_CLIENT_ID` se tlačítko na přihlašovací
stránce vůbec nenabídne.

V Google Cloudu: nový projekt → *OAuth consent screen* typu **Internal**
(školní Workspace; pak není potřeba ověřování aplikace) → rozsahy jen
`openid email profile` → *Credentials* → *OAuth client ID* typu **Web
application** → mezi *Authorized redirect URIs* patří
`https://<adresa>/api/prihlaseni/google/zpet` a pro vývoj
`http://localhost:3000/api/prihlaseni/google/zpet`.

Účet z cizí domény se odmítne vždy. Účet ze správné domény, který v aplikaci
ještě není, se podle nastavení školy buď odmítne s odkazem na správce (výchozí),
nebo se zaeviduje jako čekající a přihlásí se, až mu správce přidělí roli.
Náhledová nasazení na Vercelu mají pokaždé jinou adresu a Google vyžaduje
přesnou shodu — tam se přihlašuje heslem.

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
| `pnpm db:seed` | Vestavěné šablony a vývojový účet |
| `pnpm --filter @testmaker/web uzivatel` | Založení a odemčení účtu z příkazové řádky |
| `pnpm db:studio` | Prohlížeč databáze |
| `pnpm --filter @testmaker/web push:remote` | Přenos knihovny do produkce (viz níž) |

## Nasazení

Projekt cílí na Vercel (bezplatný tarif Hobby). Ve Vercelu nastav proměnné
prostředí:

| Proměnná | K čemu |
| --- | --- |
| `DATABASE_URL` | Turso, `libsql://…` |
| `DATABASE_AUTH_TOKEN` | token k Tursu |
| `AUTH_SECRET` | podpis přihlašovací cookie, `openssl rand -hex 32`; bez něj se nasazení neotevře |
| `GOOGLE_CLIENT_ID` | volitelně, přihlášení školním účtem Google |
| `GOOGLE_CLIENT_SECRET` | k témuž |
| `GOOGLE_REDIRECT_URI` | `https://<adresa>/api/prihlaseni/google/zpet` |
| `GOOGLE_HD` | doména školních účtů, např. `zsnekde.cz` |

Pořadí při prvním nasazení je závazné, jinak se dovnitř nedostane nikdo:
migrace (`pnpm db:migrate` proti Tursu) → založení prvního správce skriptem
`uzivatel` proti téže databázi → nasazení kódu → správce doplní učitelky.
Proměnnou `APP_PASSWORD` ze starého přihlašování jedním heslem lze po nasazení
smazat, nic už nedělá.

Generování otázek zatím běží lokálně, proto `ANTHROPIC_API_KEY` v nasazení
nastavený být nemusí; `CRON_SECRET` taky ne, plánovač na Hobby tarifu neběží.

Schéma databáze i vestavěné šablony vyřídí po každém pushi do `main` workflow
[`.github/workflows/migrate.yml`](.github/workflows/migrate.yml) (migrace
a `pnpm db:seed`). Potřebuje tajemství `TURSO_DATABASE_URL` a `TURSO_AUTH_TOKEN`
v nastavení repozitáře.

## Přenos knihovny do provozu a záloha

Knihovna vzniká na počítači a generování otázek trvá hodiny — na server se
proto nepřenáší jen aplikace, ale i hotový obsah. Cesty jsou dvě a každá je na
něco jiného.

### 1. Z počítače do produkce (jedním během)

Skript čte lokální SQLite a zapisuje **přímo do Tursa**, databáze do databáze.
Nejde přes aplikaci, takže se ho netýká strop 4,5 MB na požadavek ani časový
limit funkce; 268 materiálů s plnými texty projde jedním během za pár vteřin.

Co nastavit (do prostředí, ne do `.env.local` — jsou to přístupy k produkci):

| Proměnná | K čemu |
| --- | --- |
| `TARGET_DATABASE_URL` | cílová databáze, `libsql://…` (`turso db show <jméno> --url`) |
| `TARGET_DATABASE_AUTH_TOKEN` | token k ní (`turso db tokens create <jméno>`) |
| `SOURCE_DATABASE_URL` | zdroj; nepovinné, bez něj `file:./local.db` |

Cíl se schválně nebere z `DATABASE_URL`: ta míří na zdroj a kdyby se z ní bral
i cíl, stačilo by zapomenout jednu proměnnou a knihovna by přepsala sama sebe.

Nejdřív nanečisto — vypíše, co je ve zdroji a co v cíli, a nezapíše nic:

```bash
export TARGET_DATABASE_URL=libsql://…
export TARGET_DATABASE_AUTH_TOKEN=…
pnpm --filter @testmaker/web push:remote
```

Když čísla sedí, tentýž příkaz s `--zapsat`:

```bash
pnpm --filter @testmaker/web push:remote -- --zapsat
```

Přenáší se předměty, ročníky, témata, materiály i s texty, přílohy, otázky,
hlavolamy, šablony, testy a jejich položky se zmrazenými otázkami — v tomhle
pořadí, aby každá položka našla to, pod co patří. Fronta generování (`generation_jobs`)
se nepřenáší: je to pracovní stav jednoho počítače, ne obsah knihovny.

Schéma v cíli si skript nevyrábí — migrace tam pouští workflow
[`migrate.yml`](.github/workflows/migrate.yml) po pushi do `main`. Když tabulky
chybí, skript to řekne a nic nezkusí.

**Jak ověřit, že se data přenesla.** Na konci běhu je tabulka „zdroj / cíl /
posláno“; obě první čísla musí souhlasit. Kdo chce vidět na vlastní oči i
obsah, otevře nasazenou aplikaci a podívá se na knihovnu a na stránku
**Záloha**, kde jsou tytéž počty.

**Když se běh přeruší v půlce** (spadne síť, zavře se notebook), nic se
nerozbije: zapisuje se `insert … on conflict(id) do update`, takže se stejný
příkaz prostě spustí znovu. Co už v cíli je, se srovná, co chybí, doplní se,
a nic se nezdvojí. Ze stejného důvodu slouží skript i k pozdější
dosynchronizaci, když na počítači přibudou další otázky.

Zbývá jediná ruční situace: když někdo mezitím založil **v produkci** položku
téhož jména (například předmět „PŘÍRODOPIS“), ale s jiným `id`, sloučit je
podle jména nejde. Skript takový řádek pojmenuje a řekne, že je potřeba jednu
ze dvou položek přejmenovat a spustit přenos znovu.

### 2. Záloha a obnova pro učitelku

V aplikaci je stránka **Záloha**:

- **Stáhnout zálohu** uloží celou knihovnu do jednoho souboru JSON
  (`testmaker-zaloha-2026-09-18.json`). Odpověď odtéká postupně, takže se na ni
  strop 4,5 MB nevztahuje — dnešní knihovna dá přes 3 MB a bude přibývat.
- **Obnovit ze zálohy** soubor nejdřív jen přečte a vypíše, co v něm je;
  teprve druhé kliknutí zapisuje. Soubor krájí prohlížeč a posílá ho po
  dávkách, protože na nahrávání strop platí.

Obnova je **sloučení, ne výměna**: co má stejné `id`, se přepíše podobou ze
zálohy, co v knihovně chybí, se doplní, a nic se nemaže. Tentýž soubor jde
nahrát dvakrát, aniž by cokoli přibylo dvakrát.

Co je v plánu dál, popisuje [ROADMAP.md](ROADMAP.md). Historie změn je
v [CHANGELOG.md](CHANGELOG.md).
