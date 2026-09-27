# Zjednodušení pro učitelku: všechno v tématu

Datum: 2026-09-25

## Proč

Učitelka nechce složitou aplikaci. Dnes je jedna práce s tématem rozházená
po pěti obrazovkách (Knihovna, Import materiálů, Generování, Kontrola, Banka
otázek) a k tomu Testy. Cílem je jednoduchý model: vyberu si třídu, vyberu
téma a v tématu dělám všechno — nahrávám materiály, generuju a upravuji
otázky a vybírám je do písemky.

Zároveň generování dnes vyrábí převážně nepoužitelné otázky (příliš těžké,
špatnou češtinou, s odpověďmi, které nedávají smysl). Přestavba rozhraní bez
opravy kvality by jen hezčeji ukázala špatné otázky, proto je oprava
generování prvním krokem.

## Rozhodnutí

- **Třída** znamená ročník v předmětu (např. *Přírodopis · 6. ročník*),
  tedy existující `grades` pod `subjects`. Datový model knihovny se nemění.
- **Schvalování otázek se ruší.** Vygenerovaná otázka je hned použitelná;
  učitelka ji upraví nebo smaže, až když je potřeba.
- **Písemka vzniká z tématu**, ale může obsahovat otázky z více témat
  (opakovací test) přes „Přidat otázky" v editoru testu.
- **Lišta:** Třídy (úvod) · Testy · Hlavolamy · Šablony · uživatelské menu;
  Správa pro správce beze změny.

## Lišta a úvodní obrazovka

Nová navigace: **Třídy** (úvod s dlaždicemi) · **Testy** · **Hlavolamy** · **Šablony**
(+ **Správa** pro správce). Zrušeny (stránky mizí docela): Kontrola, Banka
otázek. Import materiálů a Generování z lišty jen mizí — stránky `/import`
a `/generovani` samy zůstávají, jen na ně nevede odkaz v liště.

- Staré adresy přesměrují: `/questions` a `/review` na `/` (úvod); `/import`
  a `/generovani` zůstávají dostupné, ale ne v navigaci (vede na ně adresa
  nebo odkaz z tématu/generování).
- **Úvod (`/`):** dlaždice tříd seskupené podle předmětu, u každé počet témat
  a otázek. Tlačítka: „Hromadný import" (import složky), „Založit předmět",
  „Nový test" (vede do editoru), vyhledávání v knihovně. Aplikace si pamatuje
  naposledy otevřenou třídu (v prohlížeči) a otevře ji rovnou.
- **Třída (`/tridy/[id]`):** seznam témat s počtem materiálů a otázek; u
  každého tématu zvlášť jeho vlastní stav generování („Generuje se…" /
  „Čeká ve frontě"), bez ohledu na to, kolik úloh běží celkem. Přidat,
  přejmenovat, přesunout a smazat téma / předmět / ročník jde přímo tady
  (přebírá to, co dnes umí Knihovna; smazat ročník jde jen správcům).
- **Ukazatel generování v liště:** pravidlo „právě jedna úloha" platí jen
  pro tenhle ukazatel — vede do tématu, když běží nebo čeká právě jedno
  generování, jinak na `/generovani` (přehled fronty). Do tématu se dostane i
  z přehledu kliknutím na řádek úlohy.
- **V prázdné knihovně** (bez tříd) se nabídnou stejné akce jako na úvodu
  (Hromadný import, Založit předmět).

## Stránka tématu (`topics/[id]`)

**Hlavička:** drobečková navigace (třída › téma), název tématu s přejmenováním
na místě, tlačítka *Vygenerovat otázky* a *Nová otázka*.

**Materiály:** sbalitelný pruh nad otázkami; když už materiály jsou, je
sbalený. Seznam souborů, nahrání dalších (extrakce textu dál v prohlížeči,
na server jde jen text), označení „duplicitní obsah", smazání. Téma bez
materiálů a bez otázek ukáže výzvu: nahrát materiál, nebo napsat první
otázku ručně.

**Generování:** dialog se ptá jen na počet (výchozí 10) a obtížnost (lehké /
střední / těžké). Typy otázek volí aplikace z ověřené sady (viz Kvalita
generování). Průběh je vidět nad seznamem otázek; hotové dávky přibývají
nahoru průběžně a stránku jde zavřít. Bez nakonfigurovaného modelu je
tlačítko skryté a stránka vysvětlí proč (platí dosavadní pravidlo).

**Otázky:** seznam karet, nejnovější nahoře. Karta ukazuje náhled otázky jako
na papíře (`QuestionPreview`), typ, body a obtížnost. Kliknutí kartu rozbalí
do editace na místě (`QuestionEditor`) s Uložit / Zrušit. Akce u karty:
Upravit, Přegenerovat (s nepovinným důvodem), Smazat. Smazání jde vrátit
(„Otázka smazána · Vrátit zpět"). Filtr nahoře: typ, obtížnost, „ještě nepoužité
v testu", **„Smazané (N)"** (obnovuje smazané otázky zpět do seznamu). Otázka
použitá v testu nese štítek s názvem testu.

**Výběr do testu:** zaškrtávátko u každé karty; při výběru se dole objeví
lišta „Vybráno N · M bodů · Vytvořit test". Vytvoření založí test
s vybranými otázkami ve výchozí šabloně, s názvem podle tématu a s odkazem
na třídu, a otevře editor testu.

## Editor testu a víc témat

- Editor `tests/[id]` zůstává (pořadí, body, nadpisy, varianty, šablona,
  tisk). Nově ukazuje třídu testu a odkaz zpět do tématu, ze kterého vznikl.
- „Přidat otázky" otevře výběr, který jako první nabízí témata téže třídy;
  jinou třídu jde zvolit v rozbalovacím seznamu. Tím vzniká opakovací test
  přes víc témat.
- Přehled Testů: moje písemky, novější nahoře, filtr podle třídy; akce
  Otevřít / Vytisknout / Kopie jako dnes.
- Hlavolamy a Šablony beze změny.

## Změny v datech

- `tests.grade_id` — nepovinný odkaz na `grades` (`on delete set null`).
  Nový test ho dostane z tématu; staré testy ho nemají a výběr otázek u nich
  začne seznamem tříd. Dotazy dál procházejí přes `Scope` (`vlastni()`,
  `viditelnyTest()`); cizí třída se tváří jako neexistující.
- Otázky: sloupec `status` zůstává. Generování ukládá rovnou `approved`.
  Jednorázová migrace převede všechny `draft` na `approved`. Smazání otázky
  z tématu nastaví `rejected` (tím funguje „Vrátit zpět" bez zvláštního
  mechanismu); `rejected` se v rozhraní nikde neukazuje. Položky hotových
  testů drží `questionSnapshot`, takže je smazání otázky nepoškodí.
- Migrace se píše tak, aby šla bezpečně pustit nad ostrou `local.db`
  (jen `UPDATE` stavu a přidání nepovinného sloupce); ověřuje se na `e2e.db`.

## Nastavení AI a Claude Code

Doplněno 2026-09-25 po rozhodnutí vyhodit Ollamu.

- **Poskytovatelé:** jen Google Gemini, OpenRouter (placený, v žebříčku
  poslední) a Anthropic s API klíčem. Ollama, paralelní workeři, Groq,
  Mistral, DeepInfra, Together, vlastní adresa a přihlášení předplatným
  (`ANTHROPIC_AUTH_TOKEN`) z aplikace mizí.
- **Jedno místo:** model a pořadí určuje jen `AI_MODELS`
  (`poskytovatel:model`, čárkou); čísla generování jsou
  v `packages/core/src/ai/settings.ts`, prompty v `packages/core/src/ai/prompts/`,
  volání modelu se žebříčkem v `packages/core/src/ai/ladder.ts`
  (sdílí ho otázky i hlavolamy). `.env.example` má AI část na pár řádků.
- **Claude Code (`/otazky`):** předplatné Claude Max v aplikaci použít nejde
  (Anthropic ho mimo Claude Code odmítá), v Claude Code ano. Téma nabízí
  „Stáhnout materiály" (text s hlavičkou o ročníku a existujících otázkách)
  a „Nahrát otázky" (JSON soubor). Skill `/otazky` píše otázky podle týchž
  pravidel jako aplikace a kontroluje je týmž kódem; soubor smí obsahovat
  všechny typy kromě `label_image`.

## Kvalita generování

Samostatný první krok, protože na něm stojí smysl celé přestavby.

- **Menší úseky:** do jednoho volání jde úsek materiálu o nejvýš 8 000
  znaků, ne až 120 tisíc. Úseky se vybírají po celém tématu, záhlaví souboru
  se přenáší do každého úseku.
- **Méně typů pro AI v aplikaci:** `single_choice`, `true_false`,
  `short_answer`, `matching`, `ordering`, `fill_blank`, `multi_choice`,
  `open` (osm typů; rozhodnutím majitele z 27. 9. 2026 doplněno o poslední
  dva). `table_fill` a `label_image` zůstávají jen pro ruční tvorbu a pro
  `/otazky` — u tabulky model plete sloupce a řádky a u popisu obrázku navíc
  chybí samotný obrázek, který se ve fázi 1 negeneruje.
- **Kratší prompt:** pravidla zúžit na ta, která model udrží (samostatná
  otázka, jednoznačná odpověď z materiálu, jazyk pro ročník, doslovná citace
  v `evidence`).
- **Kontrola citace:** otázka, jejíž citace se (po normalizaci uvozovek,
  mezer a velikosti písmen) nenajde v textu, se zahodí; otázka bez citace
  projde.
- **Duplicity:** stejné zadání lišící se jen interpunkcí nebo velikostí písmen
  se uloží jednou.
- **Srovnávací základ:** jedno téma s krátkým materiálem, 10 otázek, hodnocení
  ano/ne od učitelky; srovnávají se modely z `AI_MODELS` a otázky z `/otazky`.

## Přegenerování s důvodem (doplněno 2026-09-26)

- „Přegenerovat" na kartě otázky nabídne nepovinný důvod: štítky „Nedává
  smysl", „Špatné možnosti", „Odpověď v materiálu není", „Moc těžká",
  „Moc lehká", „Špatná čeština" a volitelnou poznámku. Bez výběru funguje
  jedním klikem jako dnes.
- Důvod jde do zadání náhrady („předchozí verze měla špatné možnosti…");
  „moc těžká / lehká" posune obtížnost náhrady.
- Důvod se ukládá k nahrazené otázce spolu s modelem, který ji vyrobil.
  Správa ukáže přehled: podíl přegenerovaných otázek podle modelu
  a nejčastější důvody (i podle předmětu).
- Z přehledu jde nejčastější chybu jedním klikem povýšit na trvalé pravidlo
  promptu; nic se do promptu nepřidává automaticky.
- Později (samostatně): „Lehčí / Těžší verze" otázky a celé písemky, varianty
  navázané na původní otázku.

## Pořadí prací

Každý krok jde nasadit samostatně a aplikace mezi nimi funguje.

1. Kvalita generování (kapitola výše).
2. Otázky v tématu: seznam karet, editace na místě, smazání s vrácením,
   zrušení schvalování včetně migrace.
3. Výběr do testu z tématu: lišta výběru, `tests.grade_id`, „Přidat otázky"
   podle třídy v editoru testu.
4. Materiály a generování v tématu: pruh materiálů, zjednodušený dialog,
   průběh nad seznamem.
5. Úvod Třídy a úklid: nová úvodní obrazovka, lišta jen s Třídy · Testy ·
   Hlavolamy · Šablony (+ Správa), přesměrování `/review` a `/questions` na
   `/`, smazání stránek Kontrola a Banka otázek a komponent, které používaly
   jen ony (`ReviewPanel` a další podle skutečných importů). `/import` a
   `/generovani` zůstávají jako stránky — jen mizí z lišty.
6. Přegenerování s důvodem a přehled chyb podle modelu (kapitola výše).
7. **Hotovo (2026-09-27).** Lehčí / těžší verze otázek a písemky: karta
   otázky nabízí v menu Přegenerovat „Lehčí verze" / „Těžší verze" (vypnuté
   na krajní obtížnosti), vytvoří novou otázku ze stejné pasáže a naváže ji
   na kořenovou otázku (verze verze se váže na kořen, ne na řetěz); karta
   ukazuje řádek „Verze: lehčí · těžší" s odkazem na obě a přeskočí na ně
   se zvýrazněním. Role `nahled` řádek vidí, ale nevytvoří. V editoru testu
   „Lehčí/Těžší verze písemky" založí soukromou kopii (`<název> – lehčí/těžší`)
   a každou položku nahradí existující verzí o stupeň jinou nebo nově
   vygenerovanou; položky bez otázky v bance, hlavolamy a položky na kraji
   obtížnosti nebo s neúspěšným generováním zůstanou beze změny a výsledek
   řekne, kolik jich zůstalo původních. Přidán sloupec `questions.variant_of`
   (migrace 0019).

## Testování

- Playwright proti `e2e.db` na portu 3100, nikdy proti `local.db`. Jeden
  průchod celou cestou: třída → téma → generování s podvrženým modelem →
  úprava otázky → výběr → vytvoření testu → přidání otázky z jiného tématu →
  tisk.
- Jednotkové testy: migrace `draft` → `approved`, smazání a vrácení otázky,
  přesměrování starých adres, kontrola citace v `evidence`, dělení materiálu
  na úseky, žebříček z `AI_MODELS`, kontrola souboru z Claude Code.
- `pnpm test`, `pnpm typecheck`, `pnpm build` po každém kroku.

## Mimo rozsah

- Změny v Hlavolamech, Šablonách, Správě a vykreslení PDF.
- Obrázkové otázky (`label_image`) a generování dalších typů přes AI.
- Výběr modelu v rozhraní; model se dál nastavuje v prostředí.
