# Plán dalšího vývoje

První fáze je hotová: import materiálů, generování otázek, banka otázek, skládání
testu a tisk do PDF. Generování běží proti Claude i Google Gemini podle toho,
který klíč je po ruce.

Podkladem byly čtyři průzkumy z 15. září 2026 nad skutečnými daty (261 materiálů,
124 témat) a nad skutečně vytištěnými PDF. Co z nich bylo hotové, je níž v části
„Hotovo"; zbytek je seřazený podle toho, co se vyplatí udělat dřív. Odhady práce
jsou hrubé.

## 1. Než se pustí knihovna celá

**Vygenerovat otázky pro celou knihovnu.** Zatím proběhlo jedno téma. Sto dvacet
čtyři témat je zhruba 1 500 otázek; s Gemini na bezplatném tarifu to nic nestojí,
ale kontrola takového množství je práce na několik večerů. Rozumné je jít po
ročnících a otázky hned procházet frontou ke schválení. *Průběžně.*

**Hromadná fronta proti skutečnému modelu.** Fronta úloh se od přidání Gemini
neověřila celá — jednotlivé generování ano, dávka přes celý ročník ne.
*Hodiny.*

## 2. Kvalita otázek

**Seznam otázek, kterým se má model vyhnout, je oříznutý na osmdesát položek.**
U témat s historií se tak nově vzniklé otázky do seznamu nemusí vejít.
*Hodiny.*

**Výběr více možností nevynucuje víc než jednu správnou odpověď** a prompt si
u devíti typů a dvanácti otázek neporadí s rovnoměrným rozdělením beze zbytku.
*Hodiny dohromady.*

**Typ „popis obrázku" je nedodělaný.** Schéma nemá souřadnice popisků, takže
čísla nejde spojit s místy v obrázku. V editoru je dnes skrytý, model ho
negeneruje. Buď dodělat s editorem bodů, nebo ho ze schématu úplně vypustit.
*Několik dní, nebo hodina na vypuštění.*

## 3. Až toho bude víc

**Banka otázek se načítá celá.** Skládání testu i přehled otázek stáhnou všechny
otázky knihovny najednou, bez stránkování. Při stovkách otázek to ještě projde,
při tisících ne. *Několik dní.*

**Hromadné generování běží z otevřeného okna.** Pro velké dávky se hodí
naplánovaná úloha na serveru. *Několik dní.*

**Přihlášení a více učitelek.** Nic v datech nemá vlastníka, takže to nebude
přidání sloupce, ale migrace napříč modelem. *Týden.*

## 4. Nápady na dál

- Import existujících písemek učitelky jako vzoru stylu i jako hotových otázek.
- Export do DOCX pro doladění ve Wordu.
- Online varianta testu pro žáky, případně export do formulářů.
- Oprava naskenovaných písemek a automatické vyhodnocení uzavřených otázek.
- Statistiky obtížnosti podle toho, jak žáci odpovídali.
- Štítky podle očekávaných výstupů RVP a doporučení skladby písemky.
- Editor šablon nad uloženým nastavením, s živým náhledem.
- Rozpoznání textu u skenovaných materiálů.
- Křížovky, osmisměrky a únikové hry.

## Hotovo

Zpětná kontrola proti původnímu seznamu ze září 2026.

**Generování.** Zaseknutá úloha se po patnácti minutách vrátí mezi čekající a
frontu jde vyprázdnit celou. Otázky se ukládají po dávkách, takže chyba v půlce
nezahodí hotovou práci. Vadná otázka už nezahodí celou dávku — z odmítnuté
odpovědi se zachrání, co je v pořádku. Přidán poskytovatel Google Gemini
a rozhodnutí podle přítomného klíče.

**Ztráta práce.** Skládání testu varuje před zavřením okna s neuloženou osnovou.
Do testu se ve výchozím stavu nabízejí jen schválené otázky a stav je vidět
u každé z nich. Neplatná adresa tématu má vlastní stránku s odkazem do knihovny.

**Kvalita otázek.** Rozpoznání duplicit bere u pravda/nepravda, doplňování
a přiřazování skutečný obsah, ne obecné zadání. Řazení má oddělené správné
pořadí. Přiřazování nedovolí použít položku vpravo dvakrát. Body nad deset se
u vygenerované otázky nahradí výchozím bodováním podle typu.

**Podklady.** Slučování témat vyžaduje shodu celého úseku názvu (124 témat se
rozpadlo na 136). Tabulky z prezentací a dokumentů si nesou oddělovače buněk
a nadpisy jsou označené. Opětovný import souboru nahradí starou verzi místo
druhé kopie. Duplicitní materiál má skutečný cizí klíč. Témata s málo textem
se rozpoznávají.

**Písemka na papíře.** Znaky, které font nemá (šipky, matematické symboly), se
nahradí čitelným textem. Přiřazování a řazení mají na papíře pokyn, jak
odpovídat. Varianta B je zaručeně jiná než A a pokyn uprostřed části už
nerozděluje míchání. Odhad stran sedí s vytištěným PDF. Obrázek má strop výšky
a chybějící obrázek se ohlásí. Hlavička tiskne učitele i poznámku. Počet řádků
na odpověď se nastavuje u položky testu.

**Rozhraní.** Hledání přes celou knihovnu, odhad stran pod osnovou, filtr
obtížnosti v kontrole konceptů, fronta ke kontrole po jedné, mazání čehokoli
v knihovně, tmavý režim, hromadný výběr a dvouřádkové dlaždice témat.

**Provoz.** GitHub Actions kontrolují každý push (typecheck, testy, build)
a po mergi do `main` spustí migrace nad produkční databází.
