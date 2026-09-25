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

- Ze lišty mizí Import materiálů, Generování, Kontrola a Banka otázek.
- Staré adresy přesměrují: `/questions` a `/review` na úvod; `/import`
  a `/generovani` na téma, pokud ho adresa nese (`?topic=`), jinak na úvod.
- Úvod ukazuje dlaždice tříd seskupené podle předmětu, u každé počet témat
  a otázek. Aplikace si pamatuje naposledy otevřenou třídu (v prohlížeči)
  a otevře ji rovnou.
- Seznam témat třídy: název, počet materiálů a otázek, ukazatel běžícího
  generování. Přidat, přejmenovat a přesunout téma jde přímo tady (přebírá
  to, co dnes umí Knihovna).
- Globální ukazatel generování v liště zůstává, ale vede do konkrétního
  tématu.

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
Upravit, Přegenerovat, Smazat. Smazání jde vrátit („Otázka smazána · Vrátit
zpět"). Filtr nahoře: typ, obtížnost, „ještě nepoužité v testu". Otázka
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

## Kvalita generování

Samostatný první krok, protože na něm stojí smysl celé přestavby.

- **Kontext Ollamy:** nastavit `num_ctx` (výchozí 16 384, přepsatelné
  proměnnou prostředí) a ověřit na workeru přes `/api/ps`, že model opravdu
  běží s tímto kontextem.
- **Menší úseky:** do jednoho volání jde úsek materiálu o 6–8 tisících
  znaků, ne až 120 tisíc. Otázky se rozkládají po úsecích.
- **Méně typů pro AI:** `single_choice`, `true_false`, `short_answer`.
  Ostatní typy zůstávají pro ruční tvorbu; AI je zatím negeneruje.
- **Kratší prompt:** pravidla zúžit na ta, která malý model udrží
  (samostatná otázka, jednoznačná odpověď z materiálu, jazyk pro ročník,
  citace v `evidence`).
- **Kontrola citace:** otázka, jejíž `evidence` se (po normalizaci mezer)
  nenajde v textu úseku, se zahodí.
- **Oprava ve větvi s workery:** paralelní dávky nad týmž úsekem si mají
  předávat už vzniklá zadání, aby nevznikaly duplicity.
- **Srovnávací základ:** jedno téma s krátkým materiálem, 10 otázek, hodnocení
  ano/ne od učitelky před změnou a po ní; podle téhož základu se pak srovnávají
  modely (`qwen3:14b` proti větším lokálním nebo cloudovým).

## Pořadí prací

Každý krok jde nasadit samostatně a aplikace mezi nimi funguje.

1. Kvalita generování (kapitola výše).
2. Otázky v tématu: seznam karet, editace na místě, smazání s vrácením,
   zrušení schvalování včetně migrace.
3. Výběr do testu z tématu: lišta výběru, `tests.grade_id`, „Přidat otázky"
   podle třídy v editoru testu.
4. Materiály a generování v tématu: pruh materiálů, zjednodušený dialog,
   průběh nad seznamem.
5. Úvod Třídy a úklid: nová úvodní obrazovka, lišta, přesměrování, smazání
   stránek `/import`, `/generovani`, `/review`, `/questions` a komponent,
   které používaly jen ony (`ReviewPanel`, `BulkGenerate` a další podle
   skutečných importů).

## Testování

- Playwright proti `e2e.db` na portu 3100, nikdy proti `local.db`. Jeden
  průchod celou cestou: třída → téma → generování s podvrženým modelem →
  úprava otázky → výběr → vytvoření testu → přidání otázky z jiného tématu →
  tisk.
- Jednotkové testy: migrace `draft` → `approved`, smazání a vrácení otázky,
  přesměrování starých adres, kontrola citace v `evidence`, dělení materiálu
  na úseky, předání `num_ctx` providerovi.
- `pnpm test`, `pnpm typecheck`, `pnpm build` po každém kroku.

## Mimo rozsah

- Změny v Hlavolamech, Šablonách, Správě a vykreslení PDF.
- Obrázkové otázky (`label_image`) a generování dalších typů přes AI.
- Výběr modelu v rozhraní; model se dál nastavuje v prostředí.
