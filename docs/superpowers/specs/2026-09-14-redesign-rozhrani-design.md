# Redesign rozhraní TestMakeru

Datum: 2026-09-14

## Proč

První fáze aplikace je funkční, ale rozhraní vzniklo jako vedlejší produkt. Vlastních
šest primitiv bez ikon, každá stránka je plochý sloupec karet a přehled vypisuje
124 témat najednou. Majitel projektu pojmenoval tři problémy: vypadá to jako
prototyp, není poznat kde jsem a co dál, a práce s otázkami stojí zbytečně moc
klikání.

Cílem je rozhraní, které učitelku provede od materiálů k hotové písemce, snese
denní používání a vypadá jako hotový produkt. Rozsah je celé rozhraní, ne
kosmetika jednotlivých stránek.

## Rozhodnutí

| Téma | Rozhodnutí |
| --- | --- |
| Charakter | Klidný profesionální nástroj. Tlumená paleta, jedna akcentní barva, obsah v popředí. |
| Rozvržení | Tři sloupce: předměty a ročníky, témata ročníku, obsah. |
| Paleta | Bílá, šedé linky, zelený akcent. Žlutá pro koncept, červená jen pro destruktivní akci. |
| Důraz | Navigace a lišty ostřejší (skoro černý text, rohy 5 px), obsah mírnější. |
| Komponenty | shadcn/ui zkopírované do `packages/ui` jako vlastní kód. |
| Skládání testu | Tři sloupce: banka, hrubý náhled, osnova. Pod 1280 px náhled odpadá. |
| Kontrola konceptů | Seznam s hromadnými akcemi plus soustředěná fronta po jedné otázce. |

## Design systém

Tokeny žijí v `packages/ui/src/styles.css` jako proměnné Tailwindu 4. Dnešní
paleta `ink` a `brand` se zachová, jen se doladí a doplní o role.

**Barvy.** Podklad bílý, druhotný podklad `#fafafa` pro panely a lišty. Text
`#0c0e12` v navigaci a nadpisech, `#3a4150` v obsahu, `#8a919f` pro doplňkové
údaje. Linky `#e0e2e7`, jemné oddělovače `#eceef1`. Akcent `#0d7355` pro hlavní
akce, správné odpovědi a vybranou položku, jeho podklad `#e4f2ed`. Koncept nese
žlutou `#fdefd6` s textem `#8a5a06`. Červená `#b03a35` se používá jen pro mazání
a zamítnutí.

**Typografie.** Systémové bezpatkové písmo. Nadpis obrazovky 19 px tučně
s proložením −0.025em. Popisky sekcí 9,5 px verzálkami, proložení 0.08em, tučné.
Běžný text 12–14 px. Čísla v přehledech tabulková, aby neposkakovala.

**Tvary.** Rohy 5 px uvnitř, 8 px u vnějších ploch, 3 px u štítků. Bez stínů,
oddělení řeší linky.

**Dva důrazy.** Navigační plochy (panel, lišta, prostřední sloupec, hlavičky
tabulek) používají skoro černý text a pevné popisky. Obsahové plochy (otázky,
formuláře, náhledy) používají mírnější text a tiché šedé štítky.

Řeší to dvě třídy, `surface-chrome` a `surface-content`, které na kořeni své
oblasti přepíšou proměnné pro barvu textu, barvu a tučnost popisků a poloměr rohů.
Komponenty samy o svém důrazu nevědí a čtou vždy tytéž proměnné, takže nevznikají
dvě sady tokenů ani dvě varianty téže komponenty.

## Rozvržení

Aplikace má jednu skořápku: horní lišta se značkou a přepínačem Knihovna / Testy
/ Šablony, pod ní pracovní plocha.

Knihovna je tři sloupce:

1. **Předměty a ročníky**, šířka 240 px. Předmět je nadpis sekce, ročníky jsou
   položky s počtem témat. Nad stromem je hledání přes celou knihovnu.
2. **Témata ročníku**, šířka 280 px. Seznam s počtem otázek u každého tématu a
   tečkou u těch, která mají nezkontrolované koncepty.
3. **Obsah tématu**, zbytek šířky.

Skládání testu má vlastní tři sloupce a nepoužívá knihovní panel, protože test
sahá napříč celou knihovnou. Šířky 300 px, plocha, 320 px.

Body zlomu: nad 1280 px tři sloupce. Mezi 1024 a 1280 px odpadá prostřední sloupec
(v knihovně splyne se seznamem obsahu, ve skládání testu zmizí náhled). Pod
1024 px zůstane jeden sloupec a přepínání záložkami.

## Obrazovky

**Knihovna a téma.** Detail tématu drží pořadí: hlavička s drobečky a názvem,
řádek s počty (materiály, otázky, ke schválení), hlavní akce, skupina materiálů,
seznam otázek. Skupinu materiálů lze rozbalit pro přejmenování, sloučení a přesun
souborů — dnešní chování zůstává, mění se jen podání.

**Generování.** Nastavení počtu, typů a obtížnosti se skryje pod rozbalení,
protože výchozí hodnoty stačí. Průběh se ukazuje v místě tlačítka, ne jako
samostatný blok.

**Kontrola konceptů.** Výchozí je seznam: zaškrtávátka, filtry typu a obtížnosti,
u každé otázky správná odpověď na jeden řádek a tlačítko Upravit. Lišta
s hromadnými akcemi se objeví až při výběru. Tlačítko *Projít po jedné* otevře
frontu, která respektuje nastavený filtr: jedna otázka přes celou šířku, pod ní
úryvek materiálu, ze kterého vznikla, a klávesy A schválit, E upravit, X zamítnout,
šipka přeskočit. Fronta ukazuje postup a dá se kdykoli opustit.

Úryvek zdroje je nová vlastnost: u vygenerované otázky se uloží název materiálu a
krátká pasáž, o kterou se opírá. Bez ní nejde odpověď ověřit jinak než otevřením
souboru.

**Skládání testu.** Vlevo banka: hledání, filtry předmětu, ročníku, typu a stavu,
otázky se zaškrtávátky. Zaškrtnutí otázku rovnou přidá do osnovy, odškrtnutí ji
vyjme. Uprostřed hrubý náhled stránky skládaný v prohlížeči z týchž dat jako PDF,
bez volání serveru; přesné PDF je na tlačítko. Vpravo osnova: otázky, nadpisy
částí, pokyny a zalomení stránky, přetahováním se mění pořadí, u otázky lze
přepsat body. Pod osnovou souhrn počtu otázek, bodů a odhadu stran.

**Šablony.** Beze změny obsahu, jen nový rám. Náhledy zůstávají skutečné stránky PDF.

## Komponenty

Do `packages/ui` přijdou ze shadcn/ui: `button`, `input`, `textarea`, `select`,
`checkbox`, `label`, `badge`, `card`, `dialog`, `dropdown-menu`, `tabs`, `tooltip`,
`separator`, `scroll-area`, `sheet`, `collapsible`, `progress`, `skeleton`.
Ikony `lucide-react`.

Nad nimi vzniknou doménové komponenty: `AppShell`, `LibrarySidebar`, `TopicList`,
`StatRow`, `QuestionCard`, `QuestionList`, `ReviewQueue`, `TestOutline`,
`TestPreview`, `BankPanel`, `EmptyState`.

Dnešní `Button`, `Field`, `Surface` se odstraní, jejich volání se nahradí.
`QuestionPreview` zůstává a přebírá nové tokeny. `TestBuilder.tsx` má 470 řádků a
při té příležitosti se rozpadne na panel banky, osnovu, náhled a nastavení.

## Co se nemění

Datový model, API, generování otázek, vykreslení PDF ani šablony. Redesign se
dotýká jen rozhraní a sdílených komponent. Jedinou výjimkou je uložení úryvku
zdroje u vygenerované otázky, které si vyžádá sloupec navíc a doplnění promptu.

## Ověření

- `pnpm test`, `pnpm typecheck` a `pnpm build` procházejí.
- Knihovna se projde od předmětu po téma a zpět bez načtení celé stránky.
- Skládání testu na šířce 1440, 1200 a 900 px drží použitelné rozvržení.
- Kontrola konceptů: seznam odbaví hromadný výběr, fronta projde dvacet otázek
  klávesami a respektuje nastavený filtr.
- Test poskládaný v novém rozhraní vytiskne stejné PDF jako dřív.
- Rozhraní se projde klávesnicí: dialogy zavírá Esc, ohnisko se nevytrácí.

## Mimo rozsah

Tmavý režim, mobilní telefon (pod 768 px), editor šablon, přihlášení.
