# Plán dalšího vývoje

První fáze je hotová: import materiálů, generování otázek, banka otázek, skládání
testu a tisk do PDF. Následuje seznam toho, co z toho zatím nefunguje dobře a co
chybí, seřazený podle toho, co se vyplatí udělat dřív.

Podklad jsou čtyři průzkumy z 15. září 2026 nad skutečnými daty (261 materiálů,
124 témat) a nad skutečně vytištěnými PDF. Odhady práce jsou hrubé.

## 1. Než se pustí generování naostro

Tyhle věci se projeví hned při prvním skutečném použití. Generování zatím nikdy
neběželo proti modelu, takže je to neprošlapaná cesta.

**Zaseknutá úloha ve frontě zablokuje téma natrvalo.** Runner označí úlohu jako
běžící a nic ji nevrátí zpět. Zavření okna uprostřed hromadného generování tedy
téma vyřadí, dokud někdo nesáhne do databáze. Mazání fronty se běžících úloh
netýká. Řešení: časový limit, po kterém se úloha vrátí mezi čekající, a možnost
frontu vyprázdnit celou. *Půl dne.*

**Jedna špatně tvarovaná otázka zahodí celou dávku.** Model vrací dvanáct otázek
v jednom objektu a ověřují se najednou, takže chyba v jedné zahodí všech dvanáct
i po opakování. Při deseti různých typech v jedné dávce je to za 124 témat
prakticky jisté. Řešení: generovat po menších skupinách téhož typu, nebo přijímat
otázky po jedné a vadné jen přeskočit. *Den až dva.*

**Otázky se ukládají až na konci.** U dvou největších témat se text dělí na části
a chyba ve druhé zahodí i otázky z první. Řešení: ukládat po každé části.
*Hodiny.*

**Ověřit první volání modelu.** Výchozí model má zapnuté adaptivní uvažování a
knihovna si strukturovaný výstup vynucuje voláním nástroje. Než se pustí dávka
přes celou knihovnu, spustit jedno téma a podívat se, co se vrátí. *Hodiny.*

**Rozvaha nad modelem a cenou.** Všech 124 témat vyjde zhruba na 1 500 otázek,
40 až 120 minut souvislého běhu a řádově 15 až 40 dolarů. S levnějším modelem
zhruba dvaapůlkrát méně. Stojí za to porovnat kvalitu na jednom tématu, než se
pustí celá knihovna.

## 2. Aby se neztrácela práce

**Skládání testu nemá pojistku proti zavření okna.** Rozpracovaná osnova zmizí
bez varování. Řešení: upozornění při odchodu, případně průběžné ukládání.
*Hodiny.*

**Do testu jde omylem zařadit zamítnutý koncept.** Filtr na schválené otázky je
ve skládání testu vypnutý a stav otázky v bance není vidět, takže nezkontrolovaná
ani zamítnutá otázka vypadá stejně jako schválená. Řešení: ukázat stav u každé
otázky a filtr zapnout ve výchozím stavu. *Půl dne.*

**Neplatná adresa tématu končí u obecné hlášky Next.js.** Stane se to po smazání
nebo sloučení tématu a návratu zpět v prohlížeči. Řešení: vlastní stránka s
odkazem do knihovny. *Hodiny.*

## 3. Kvalita otázek

**Seznam otázek, kterým se má model vyhnout, je oříznutý na čtyřicet položek** a
nově vzniklé otázky se do něj u témat s historií nedostanou. *Hodiny.*

**Rozpoznání duplicit selhává u tří typů.** U pravda/nepravda, doplňování a
přiřazování se porovnává jen zadání, které u nich bývá obecné, takže se stejný
obsah v jiném obalu nezachytí. *Půl dne.*

**U řazení není odděleno správné pořadí od zadaného.** Když model vrátí položky
seřazené jinak, nejde to nijak odhalit. Řešení: samostatné pole se správným
pořadím. *Půl dne včetně migrace.*

**Drobnosti v promptu a schématu.** Prompt žádá rovnoměrné rozdělení mezi devět
typů při dvanácti otázkách, což nevychází. Výběr více možností nevynucuje víc než
jednu správnou odpověď. Přiřazování dovolí použít položku vpravo vícekrát.
*Hodiny dohromady.*

## 4. Kvalita podkladů

**Slučování témat je místy příliš ochotné.** Téma „Rostliny" spojilo sedm souborů
ze čtyř různých lekcí (obecný úvod, výtrusné rostliny, kapraďorosty, mechorosty),
protože mají společné jedno slovo. Generování pak míchá nesouvisející látku.
Řešení: vyžadovat podíl společných slov vůči oběma názvům, ne jen obsažení.
*Půl dne.*

**Tabulky v prezentacích a dokumentech se slepí.** Buňky v řádku nemají oddělovač,
takže z tabulky vznikne jedna dlouhá věta. Nadpisy se navíc nijak neodliší od
běžného textu, takže model nepozná strukturu. *Půl dne.*

**Devatenáct témat ze 124 má pod tisíc znaků.** Na písemku to nestačí. Aplikace
to nikde neříká a klidně z nich nechá generovat. Řešení: označit je a varovat.
*Hodiny.*

**Opakovaný import upraveného souboru přidá druhou kopii.** Aplikace nezná pojem
„tenhle soubor nahrazuje tamten", takže v tématu zůstane stará i nová verze.
*Den.*

**Materiály označené jako duplicita nemají cizí klíč.** Smazáním původního
materiálu vznikne odkaz do prázdna a takový materiál se navždy tiše přeskakuje.
*Hodiny.*

## 5. Písemka na papíře

Ověřeno na skutečně vygenerovaných PDF ve všech třech šablonách.

**Šipka se nevykreslí.** Font neobsahuje znak `→`, takže se místo něj vytiskne
pahýl. Odpovědi typu „nos → hrtan → plíce" jsou přitom běžné. Řešení: doplnit
znak do fontu, nebo ho před tiskem nahradit. *Hodiny.*

**Přiřazování a řazení nemají na papíře pokyn, jak odpovídat.** U položek je jen
prázdný čtvereček, nikde není řečeno, jestli se má psát písmeno, nebo číslo.
*Hodiny.*

**Varianta B nemusí být jiná než A.** Míchání neověřuje, že se pořadí skutečně
změnilo, takže u krátké písemky nebo u otázky se dvěma možnostmi může vyjít
totožně. *Hodiny.*

**Pokyn uprostřed části rozdělí míchání.** Otázky před pokynem a za ním se
navzájem nepromíchají, i když patří k sobě. *Hodiny.*

**Odhad počtu stran se u kompaktní šablony rozchází.** Náhled slibuje jednu
stranu tam, kde skutečné PDF potřebuje dvě. *Půl dne.*

**Obrázek bez omezení výšky může spolknout stránku** a chybějící obrázek se tiše
přeskočí, takže se prázdné místo objeví až na vytištěné písemce. *Hodiny.*

**Otázka typu popis obrázku je nedokončená.** Schéma nemá souřadnice popisků,
takže čísla nejde spojit s místy v obrázku. Dnes ji nejde ani vytvořit. Buď
dodělat s editorem bodů, nebo ji zatím úplně skrýt. *Několik dní, nebo hodina na
skrytí.*

**Hlavička neumí učitele a poznámku,** i když je datový model má.

**Do osnovy jde přidávat jen na konec** a otázku nejde použít dvakrát.

## 6. Co chybí proti zadání

**Hledání přes celou knihovnu.** Zadání ho žádalo nad panelem s ročníky, plán na
něj zapomněl. Při 124 tématech je to ta funkce, kvůli které panel vznikl.
*Den.*

**Odhad počtu stran v souhrnu pod osnovou.** Čísla stran jsou dnes jen uvnitř
náhledu, který se na širokých obrazovkách skrývá. *Hodiny.*

**Filtr obtížnosti v kontrole konceptů.** *Hodiny.*

## 7. Až toho bude víc

**Banka otázek se načítá celá.** Skládání testu i přehled otázek stáhnou všechny
otázky knihovny najednou, bez stránkování. Při stovkách otázek to ještě projde,
při tisících ne. *Několik dní.*

**Testy nejsou zmrazené.** Položka testu odkazuje na živou otázku, takže úprava
otázky tiše změní i písemku, která už je vytištěná. Řešení: uložit si obsah
otázky v okamžiku zařazení do testu. *Den až dva, s migrací.*

**Obrázky se nikdy neuvolní.** Smazání otázky nechá přílohu ležet v databázi.
*Hodiny.*

**Přihlášení a více učitelek.** Nic v datech nemá vlastníka, takže to nebude
přidání sloupce, ale migrace napříč modelem. *Týden.*

**Hromadné generování běží z otevřeného okna.** Pro velké dávky se hodí naplánovaná
úloha na serveru. *Několik dní.*

## Nápady na dál

- Import existujících písemek učitelky jako vzoru stylu i jako hotových otázek.
- Export do DOCX pro doladění ve Wordu.
- Online varianta testu pro žáky, případně export do formulářů.
- Oprava naskenovaných písemek a automatické vyhodnocení uzavřených otázek.
- Statistiky obtížnosti podle toho, jak žáci odpovídali.
- Štítky podle očekávaných výstupů RVP a doporučení skladby písemky.
- Editor šablon nad uloženým nastavením, s živým náhledem.
- Rozpoznání textu u skenovaných materiálů.
- Křížovky, osmisměrky a únikové hry.
