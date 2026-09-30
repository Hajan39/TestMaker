# Pracovní listy

Datum: 2026-09-30

## Proč

Písemka slouží ke zkoušení: body, známka, otázky z banky, které vznikly
z materiálů tématu. Učitelka ale potřebuje i list na procvičování v hodině
nebo doma. Nic se na něm nehodnotí, je pestřejší (krátké texty, fun facts,
tabulky k doplnění) a jeho obsah nemusí vycházet jen z nahraných materiálů.
Model smí přidat obecné znalosti k tématu a učitelka smí dodat vlastní text
nebo zadat téma, které v knihovně vůbec není.

List vygeneruje model jako koncept a učitelka ho pak upraví stejně jako
písemku.

## Co platí dál

- Tvar dat určuje zod v `packages/core/src/schema`; žádná druhá definice.
- Šablony jsou data, PDF kreslí jeden generický renderer.
- Na server jde jen text, nikdy originální soubory.
- Bez použitelného modelu se generování skryje a vysvětlí proč.
- Písemky, hlavolamy a nově i listy patří autorce; cizí se tváří jako
  neexistující (`null` a 404).

## Co se vědomě mění

Zásada „Generuje se ze skupiny, ne ze souboru“ platí pro banku otázek dál.
List je výjimka: smí vzniknout z tématu i bez materiálů, z volného zadání
nebo z vloženého textu. Úlohy listu proto **do banky nikdy nejdou**, aby se
otázky z obecných znalostí nemíchaly s otázkami ověřenými proti materiálům.

## Rozsah první verze

Uvnitř:

- vlastní záložka „Pracovní listy“ s přehledem a editorem,
- generování celého listu jedním voláním modelu a přegenerování jednoho kusu,
- položky: nadpis, pokyn, zalomení strany (stávající), úloha libovolného
  stávajícího typu otázky, **krátký text**, **fun fact**, **tabulka
  k doplnění**,
- značka „ověř“ u obsahu, který nevychází z materiálů,
- tisk do PDF včetně klíče pro učitelku.

Mimo (případně později):

- hlavolamy v listu (technicky jdou přidat jako u písemky, v první verzi se
  nenabízejí),
- schéma nebo obrázek k popisu, časová osa, porovnání,
- ukládání úloh z listu do banky a výběr otázek z banky do listu,
- delší výkladové texty (jen krátké texty bez odstavců).

## Data

### `tests`

List je druh písemky; editor, šablony, vykreslení, klíč, varianty i sdílení
ve škole se používají společně.

| Sloupec | Typ | Význam |
|---|---|---|
| `kind` | text, `pisemka` \| `pracovni_list`, výchozí `pisemka` | druh; stávající řádky zůstávají písemkami |
| `topic_id` | text, nepovinný, FK `topics.id` `on delete set null` | téma z knihovny u listu k tématu; u volného zadání prázdné |
| `brief` | text, nepovinný | zadání listu, jak ho učitelka napsala, včetně vloženého textu; slouží k přegenerování kusů |

U listu je `graded` vždy `false`: server to vynutí při založení i uložení,
bez ohledu na to, co pošle klient. Ročník volného zadání se ukládá do
stávajícího `grade_id`, u listu k tématu se doplní z tématu.

### `test_items`

| Změna | Význam |
|---|---|
| `kind` rozšířen o `text` a `table` | nové druhy položek |
| nový sloupec `content` (JSON, nepovinný) | obsah položky, která se nevejde do `text`: u `text` varianta, u `table` mřížka |
| nový sloupec `needs_check` (boolean, výchozí `false`) | značka „ověř“ |

Úloha v listu je položka `question` s prázdným `question_id` a obsahem jen
v `question_snapshot`. Vykreslení i klíč už dnes čtou ze snímku.

### Schéma v core

Do `packages/core/src/schema/test.ts`:

- `TEST_ITEM_KINDS` rozšířit o `text` a `table`,
- `testKindSchema = z.enum(['pisemka', 'pracovni_list'])`,
- `textItemContentSchema = z.object({ variant: z.enum(['text', 'fun_fact']) })`
  (vlastní text je ve sloupci `text`; strop `AI_SETTINGS.worksheet.textMax`
  platí jen pro výstup modelu, ruční úpravu učitelky délkou neomezuje),
- `tableItemContentSchema`:
  - `caption` (nepovinný popisek nad tabulkou),
  - `header: string[]` (1–6 sloupců),
  - `rows: { value: string; blank: boolean }[][]` (1–12 řádků, každý řádek
    má tolik buněk, kolik je sloupců),
  - aspoň jedna buňka `blank`, jinak není co doplňovat,
- `parseItemContent` po vzoru `parseQuestionSnapshot`: poškozený obsah vrací
  `null` a položka se v náhledu ukáže jako chybná, místo aby spadl celý list.

### Migrace

Jedna migrace vygenerovaná `pnpm db:generate` nad základem `0000_zaklad`,
se snímkem v `apps/web/drizzle/meta`. Po přidání znovu `pnpm db:generate`
nesmí hlásit změnu. Zálohy (`lib/backup.ts`) i obnova nové sloupce přenášejí;
`push-remote.ts` projde, protože kopíruje celé tabulky. Ověřit, že obnova
starší zálohy bez nových sloupců doplní výchozí hodnoty.

## Generování

### Vstup (formulář „Nový pracovní list“)

- zdroj: **téma z knihovny** (výběr předmět → ročník → téma), nebo **volné
  zadání** (název listu a ročník ze seznamu ročníků školy),
- volitelný **pokyn** (např. „víc tabulek, jeden fun fact, na 20 minut“),
- volitelně **vlastní text** vložený do textového pole (jen text).

Ze vstupu se složí `brief` a uloží se k listu.

### Co jde do modelu

- materiály tématu kromě těch označených jako duplicitní obsah, zkrácené do
  rozpočtu `AI_SETTINGS.worksheet.materialChars` stejně jako u hlavolamů
  (`fitMaterials`),
- vlastní text a pokyn,
- název tématu nebo listu a ročník.

Bez materiálů i bez vlastního textu pracuje model jen z názvu a ročníku.
Prompt mu výslovně říká, že u každé položky má přiznat, jestli vychází
z dodaného textu.

### Co přijde z modelu

Objekt podle zod schématu v `packages/core/src/ai/worksheet.ts`:

```ts
{
  title: string,
  items: Array<
    | { kind: 'heading' | 'instruction'; text: string; fromMaterials: boolean }
    | { kind: 'text'; variant: 'text' | 'fun_fact'; text: string; fromMaterials: boolean }
    | { kind: 'table'; table: TableItemContent; fromMaterials: boolean }
    | { kind: 'question'; question: QuestionContent; fromMaterials: boolean }
  >
}
```

`fromMaterials: false` se uloží jako `needs_check = true`. U volného zadání
bez vlastního textu dostanou značku všechny položky kromě nadpisů a pokynů.

### Ověření v kódu

Model se pravidel spolehlivě nedrží, proto se v kódu ověří, co jde:

- úloha proti `questionContentSchema`: vadná úloha se vyřadí a list vznikne
  ze zbytku (vzor: záchrana dávky u otázek),
- tabulka proti `tableItemContentSchema`: nesedící počet buněk v řádku nebo
  žádná prázdná buňka = položka vyřazena,
- text delší než `textMax` se vyřadí, ne ořízne (oříznutá věta by nedávala
  smysl),
- zůstane-li po ověření méně než `minItems` položek, generování skončí českou
  chybou s radou (zkusit znovu nebo upravit pokyn) a nic se neuloží.

Vyřazené položky se učitelce ukážou v souhrnu po vygenerování („2 položky
model nevrátil v pořádku a vynechaly se“).

### Kam co patří

- prompt: `packages/core/src/ai/prompts/worksheet.ts`,
- volání přes žebříček (`startLadder`, `objectCall`) a ověření:
  `packages/core/src/ai/worksheet.ts`,
- čísla: `AI_SETTINGS.worksheet` v `packages/core/src/ai/settings.ts`
  (`materialChars`, `textMax`, `minItems`, `maxItems`),
- route: `apps/web/src/app/api/worksheets/generate/route.ts`, `maxDuration`
  jako u slov do hlavolamu; volá core, uloží list i položky v jedné transakci
  a vrátí id listu.

### Přegenerování jednoho kusu

Tlačítko u položky pošle `brief`, druh položky (a u úlohy její typ) a
stávající položky listu, aby se neopakovaly. Model vrátí jednu položku téhož
tvaru, ověří se stejně a nahradí původní na stejném místě.
Route: `apps/web/src/app/api/worksheets/[id]/items/[itemId]/regenerate/route.ts`.

### Bez modelu

Když není použitelný model, tlačítko „Vygenerovat“ se skryje s vysvětlením
jako u otázek a formulář nabídne založit prázdný list k ručnímu vyplnění.
Přegenerování kusu se v editoru nenabízí.

## Rozhraní

### Záložka a přehled

- „Pracovní listy“ v horní liště (`AppChrome`) vedle Hlavolamů a Testů,
  trasa `/listy`, role jako u testů (`nahled` čte, ostatní mění).
- Přehled jako u testů: vlastní a sdílené ve škole, filtr podle třídy,
  tlačítko „Nový pracovní list“.
- Přehled testů (`/tests`) a jeho dotazy v `lib/tests.ts` dostanou podmínku
  `kind = 'pisemka'`, přehled listů `kind = 'pracovni_list'`. Detail
  otevřený přes nesprávnou trasu přesměruje na správnou.

### Editor

`TestBuilder` s režimem odvozeným z `test.kind`:

- skryté: body a jejich přepis, políčko na známku, přepínač „na známky“,
  výběr otázek z banky a porovnání se živou otázkou,
- přidané akce: „Přidat text“, „Přidat fun fact“, „Přidat tabulku“,
  „Přidat úlohu“ (otevře stávající editor otázky; výsledek se uloží do
  snímku položky, ne do banky),
- editor tabulky: úprava buněk na místě, přidat/ubrat řádek a sloupec
  v mezích schématu, u buňky přepínač „prázdná na vyplnění“,
- štítek „ověř“ u položek s `needs_check`; kliknutím se značka odškrtne,
  úprava položky ji neodškrtává sama,
- u každé položky „Přegenerovat“ (jen když je model nastavený),
- přetahování, mazání, nadpisy, pokyny a zalomení strany beze změny.

Nad listem, který má nějakou značku „ověř“, je nenápadné upozornění
s počtem položek ke kontrole. Tisk nijak neblokuje.

Texty rozhraní česky, barvy jen z tokenů `packages/ui/src/styles.css`,
nové komponenty skládat ze stávajících v `packages/ui`.

## Tisk

V `packages/core/src/pdf`:

- `TestDocument` vykreslí `text` jako krátký odstavec a `fun_fact`
  v rámečku; vzhled rámečku (okraj, podbarvení, popisek „Věděli jste?“) je
  nová část `TemplateConfig` s výchozí hodnotou, aby stávající šablony
  fungovaly beze změny,
- `table` jako tabulku s linkami; buňky `blank` prázdné s výškou na psaní
  rukou, v klíči (`answerKey.ts`) vyplněné,
- úlohy listu bez bodů (list má vždy `graded = false`),
- značka „ověř“ se netiskne,
- tabulka se přes stránku láme po řádcích se zopakovaným záhlavím; odhad
  výšky (`estimate.ts`) nové položky zná.

Vykreslení se volá dál jen přes `renderTestToBuffer` v core.

## Rozsah dotazů

Funkce pro listy žijí v `apps/web/src/lib/tests.ts` vedle písemek, berou
`Scope` a používají `vlastni()` / `viditelnyTest()`. Cizí list vrací `null`
a 404. Generování ověří, že vybrané téma patří do školy (`skola()`). Nic
nového v `proxy.ts` kromě trasy `/listy` v hrubém sítu rolí.

## Chyby

- model nedostupný, vyčerpaný limit, neplatná odpověď: česká hláška
  z `describeAiError` s radou, co dělat; nic se neuloží,
- téma zmizelo mezi otevřením formuláře a odesláním: 404 s hláškou „Téma už
  v knihovně není, vyber jiné.“,
- smazání tématu: list zůstává, `topic_id` se vyprázdní, v přehledu se ukáže
  jako volné zadání.

## Testy

Jednotkové (core, `pnpm test`):

- schémata textu a tabulky včetně mezí,
- ověření výstupu modelu: vyřazení vadné úlohy, tabulky i dlouhého textu,
  chyba při méně než `minItems`, převod `fromMaterials` na `needs_check`,
- vykreslení nových položek a klíče; ověřit na vygenerovaném PDF
  (`RENDER_SAMPLES=1 … test/render-samples.test.ts`) s ukázkovým listem.

Web:

- migrace: `pnpm db:generate` bez změny, obnova zálohy bez nových sloupců,
- dotazy: list se neobjeví v přehledu testů, cizí list vrací `null`.

E2E (`e2e.db`, port 3100):

- ruční založení listu, přidání fun factu a tabulky, tisk, klíč,
- list není v přehledu Testy a písemka není v Pracovních listech,
- formulář generování s odpovědí route podvrženou přes `page.route`
  v Playwrightu (serverovou část pokrývají jednotkové testy core; do
  produkčního kódu se žádný testovací přepínač nepřidává),
- odškrtnutí značky „ověř“,
- v `seed-e2e.ts` jeden hotový list, aby měl přehled co ukázat.

Na závěr `pnpm test`, `pnpm typecheck`, `pnpm build`.
