# Změny

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/).

## [Nevydáno]

### Přidáno

- **Nová navigace: Třídy místo Knihovny.** Úvod aplikace ukazuje dlaždice tříd
  (ročníky v předmětech) seskupené podle předmětu. Poslední otevřená třída se
  pamatuje a otevře automaticky. Lišta zůstává jednoduchou: Třídy · Testy ·
  Hlavolamy · Šablony (+ Správa pro správce).
- **Třída má vlastní stránku** se seznamem témat, počtem materiálů a otázek,
  a ukazatelem běžícího generování. Přidat, přejmenovat, přesunout a smazat
  téma / předmět / ročník jde přímo tady.
- **Obnovení smazaných otázek v tématu.** Filtr „Smazané (N)" nabídne vrácení
  smazaných otázek zpět do seznamu bez dalšího importu či generování.
- **Přegenerování s důvodem.** Na kartě otázky se nabídne nepovinný důvod jako
  štítek (Nedává smysl, Špatné možnosti, Odpověď v materiálu není, Moc těžká,
  Moc lehká, Špatná čeština) a volitelná poznámka navíc; jen „Moc těžká" a
  „Moc lehká" posunují obtížnost náhrady o stupeň, ostatní důvody ji nechávají
  beze změny.
- **Otázky z Claude Code.** Na stránce tématu jde **stáhnout materiály** jako
  jeden textový soubor (s ročníkem a otázkami, které už v tématu jsou),
  v Claude Code z nich příkazem `/otazky` nechat napsat otázky a soubor
  **nahrát zpátky** do tématu. Nahrání kontroluje totéž co generování
  v aplikaci a co neprojde, vypíše s důvodem.
- **Zkušební generování** (`generate:try`) ze staženého souboru bez databáze —
  výsledek se zapíše do Markdownu k ručnímu hodnocení a srovnání modelů.
- **Kontrola citace.** Každá vygenerovaná otázka musí doslova citovat větu
  z materiálu; otázka s citací, která v materiálu není, se zahodí.
- **Lehčí a těžší verze otázky.** Z nabídky Přegenerovat jde místo nahrazení
  vytvořit novou otázku ze stejné pasáže s obtížností o stupeň jinou; původní
  otázka zůstává a karta ukáže odkaz na obě verze. Tlačítko je vypnuté na
  krajní obtížnosti (1 nebo 3). Lehčí verze těžší verze se váže na původní
  (kořenovou) otázku, ne na řetěz mezi sebou — karta tak vždycky ukazuje
  všechny verze pohromadě. **Vyžaduje migraci 0019** (`questions.variant_of`) —
  před nasazením spusť nad `local.db` zálohovaně:
  `cd apps/web && cp local.db local.db.pred-migraci && pnpm db:migrate`.
  Stejnou migraci musí dostat i produkční databáze v Tursu dřív, než se
  nasadí kód (ručně `pnpm db:migrate` proti Tursu; workflow `migrate.yml`
  běží až po pushi do `main`, souběžně s nasazením) — jinak nasazená
  aplikace spadne na chybějícím sloupci.
- **Lehčí a těžší verze celé písemky.** V editoru testu vznikne soukromá
  kopie („‹název› – lehčí" / „‹název› – těžší"), ve které se každá položka
  nahradí existující verzí o stupeň jinou, nebo se vygeneruje nová. Položky
  bez otázky v bance, hlavolamy, otázky na kraji obtížnosti a otázky, u
  kterých se generování nepovedlo, zůstanou beze změny; výsledek řekne,
  kolik jich zůstalo původních. Neuložené změny v editoru si aplikace nechá
  nejdřív uložit.
- **AI teď generuje osm typů otázek** místo tří — přibyly přiřazování dvojic,
  řazení, doplňování do textu, výběr více možností i volná odpověď. Tabulku
  a popis obrázku model dál nezvládá; zůstávají na ruční psaní nebo na
  `/otazky`.

- **Předmět, ročník i téma jde založit a přejmenovat ručně**, bez importu
  materiálů. Do prázdného tématu si tak jde rovnou psát vlastní otázky a název
  převzatý z názvu složky se dá opravit.
- **Název písemky je vidět v hlavičce** skladače, ne schovaný v postranním
  panelu; když chybí, aplikace na pole rovnou skočí.
- **Hromadné schválení a zamítnutí jde vzít zpět.** Aplikace řekne, co udělala,
  a deset sekund nabízí návrat do původního stavu.
- **Náhodně sestavená písemka.** Učitelka zaškrtne okruhy (klidně celý ročník),
  řekne kolik otázek nebo kolik bodů, jaké typy a obtížnost, a aplikace test
  poskládá — otázky rozprostře mezi vybraná témata i mezi typy. Los jde
  zopakovat („Zamíchat znovu“), nic se neukládá bez potvrzení a vložené
  položky jdou v osnově dál upravit.
- **Stavy načítání.** Místo zmrzlé plochy se ukáže kostra obsahu ve tvaru
  toho, co přijde, a tlačítka akcí po dobu běhu říkají, co dělají
  („Schvaluji…“, „Mažu…“). Kostra se objevuje se zpožděním, aby u rychlé
  odpovědi nezablikala.
- **Dogenerování na cílový počet.** U tématu i u hromadného generování jde
  místo „vytvoř N nových“ zvolit „doplň téma na N otázek celkem“; zamítnuté
  se do počtu nepočítají, takže po kontrole konceptů stačí dorovnat počet.
  Detail tématu ukazuje, kolik otázek v něm už je a kolik jich přibude.
- **Hromadné generování z příkazové řádky** (`generate:bulk`) pro celý
  ročník, předmět, nebo celou knihovnu — nepotřebuje otevřené okno.

- **Hotová písemka se nemění pod rukama.** Při zařazení otázky do testu se
  uloží snímek jejího obsahu; pozdější úprava ani smazání otázky v bance už
  vytištěný test nezmění. V osnově je vidět, že se banka mezitím rozešla.
- **Nadpis, pokyn a zalomení strany jde vložit kamkoli** do osnovy, ne jen na
  konec, a táž otázka smí být v testu víckrát (rozcvička a pak znovu v jiné
  části).
- **Počet řádků na odpověď se nastavuje v testu.** U volné odpovědi si učitelka
  zvolí, kolik místa žák dostane, aniž by měnila otázku v bance — v opakování
  na závěr roku se hodí víc místa než v desetiminutovce.
- **Testy webové vrstvy.** Ukládání testů, mazání v knihovně, rozpoznávání
  duplicit i chování bez klíče k modelu mají vlastní testy nad dočasnou
  databází; dřív nebyl otestovaný ani jeden API endpoint.
- **CI/CD přes GitHub Actions.** Každý push a pull request projde
  typecheckem, testy a buildem (`ci.yml`); po mergi do `main` se navíc
  spustí migrace produkční Turso databáze (`migrate.yml`), a to i ručně
  přes „Run workflow“. Bez nastavených tajemství `TURSO_DATABASE_URL` a
  `TURSO_AUTH_TOKEN` se migrace sama přeskočí a napíše to do logu, místo
  aby spadla.
- **Tmavý režim.** Přepínač v liště nabízí světlý, tmavý a „podle systému“;
  volba se pamatuje v prohlížeči a nastaví se ještě před vykreslením, takže
  nic neproblikne. Barvy jsou jen tokeny, komponenty o režimu nevědí.
- **Hromadný výběr všude, kde se zaškrtává.** V otázkách tématu „Vybrat vše“
  vezme vše, co projde filtrem, v bance otázek jde zaškrtnout celé téma i celý
  filtr naráz a u typů otázek se všechny vrátí jedním tlačítkem.
- **Dlaždice tématu na dvou řádcích:** název nahoře, pod ním počet materiálů
  a kolik otázek čeká na kontrolu. Z přehledu ročníku je tak vidět, kde je
  práce, bez otvírání tématu.
- **Fronta ke kontrole vygenerovaných konceptů.** Otázky se procházejí jedna po
  druhé místo dlouhého seznamu, u každé je vidět úryvek materiálu, ze kterého
  vznikla, a schválit, zamítnout, upravit nebo přeskočit jde jen klávesnicí —
  psaní vlastního textu do políčka se přitom se zkratkami nekříží.
- **Doklad původu u vygenerované otázky.** Ke každé otázce z modelu se ukládá
  název materiálu a citovaná pasáž, ze které vznikla, takže učitelka může
  ověřit, odkud se odpověď vzala, než ji schválí.

- **Import materiálů z celé složky.** Text z PDF, ODP, ODT, ODS, DOCX, HTML a
  prostého textu se extrahuje v prohlížeči ve web workeru; na server jde jen
  text. Stejný import je k dispozici i jako skript nad složkou na disku.
- **Odvození struktury ze složek** na Předmět → Ročník → Téma, včetně názvů
  v rozloženém tvaru (macOS) a názvů poškozených při rozbalení archivu.
- **Skupiny materiálů.** Soubory popisující tutéž lekci se spojí do jedné
  skupiny a otázky se generují ze všech naráz. Obecný název bez rozlišujícího
  slova skupinu nezakládá, takže se nespojí různé lekce. Skupinu lze
  přejmenovat, sloučit s jinou a přesouvat mezi nimi jednotlivé soubory.
- **Rozpoznání téhož obsahu ve dvou formátech** (PDF vytištěné z prezentace).
  Slabší kopie se označí a do generování nevstupuje.
- **Google Gemini jako druhý poskytovatel generování.** Rozhodne přítomný klíč:
  když je vyplněný jen klíč ke Gemini, použije se on. Výchozí model je
  `gemini-flash-latest`, protože modely řady „pro“ mají na bezplatném tarifu
  nulový limit.
- **Generování otázek** přes Vercel AI SDK s vyměnitelným poskytovatelem
  (Claude, Gemini, Ollama). Průběh se streamuje, už existující zadání dostane model
  jako seznam, kterému se má vyhnout.
- **Hromadné generování** pro celý předmět nebo ročník přes frontu v databázi,
  zpracovávanou po jedné skupině.
- **Deset typů otázek** včetně doplňování do textu, přiřazování dvojic, řazení
  a doplňovací tabulky. Otázky lze upravovat i psát vlastní; k otázce jde
  připojit tabulku nebo obrázek.
- **Banka otázek** s filtry, hledáním, hromadným schvalováním a mazáním.
- **Skládání testu napříč předměty a ročníky** s nadpisy částí, pokyny,
  zalomením stránky a přepisem bodů u jednotlivých otázek.
- **Tisk do PDF na A4** s hlavičkou, body, klíčem správných odpovědí a
  variantami A/B. Test může být i bez známek.
- **Tři vestavěné šablony** (Klasická, Kompaktní, Pracovní list) uložené jako
  nastavení, ne jako kód. Náhled šablony je skutečná stránka PDF.

### Odebráno

- **Stránka Kontrola (Review).** Otázky se schvalují jen implicitně — vygenerovaná
  otázka je hned použitelná; upraví se nebo se smaže, až když je potřeba.
- **Banka otázek jako samostatná stránka.** Otázky se spravují přímo v tématu,
  kde se generují. Filtr „Smazané" umožňuje obnovit smazané otázky bez dalšího
  importu.
- **Staré adresy `/questions` a `/review` se přesměrují na `/` (úvod).**
- **Hledání v textu otázek napříč celou knihovnou.** Hledání na úvodu najde
  jen předmět, ročník nebo téma podle názvu; smazanou otázku jde najít a
  obnovit jen uvnitř jejího tématu (filtr „Smazané").

### Opraveno

- **Tisk už nikdy nepřiloží klíč k zadání pro žáky.** Dřív byl klíč ve výchozím
  stavu zapnutý, takže učitelka mohla rozdat i správné odpovědi; totéž tlačítko
  v seznamu testů klíč naopak nepřidalo nikdy. Nově je všude dvojice „Zadání pro
  žáky“ a „Klíč pro mě“, pro tisk i pro stažení.
- **Fronta ke kontrole ukazuje jen koncepty.** Dědila zapnutý filtr, takže
  učitelka procházela i otázky, které už schválila.
- **Tlačítko „Smazat“ bylo červené písmo na červeném pozadí** všude, kde stálo
  v destruktivní variantě.

- **Chyby od modelu jsou česky a říkají, co dělat.** Místo „You exceeded your
  current quota" stojí u generování věta o vyčerpaném denním limitu
  bezplatného tarifu a o tom, že jde přepnout model.

- **Klíč odkazoval na značky, které na papíře nebyly.** Tvrzení u pravda/nepravda,
  mezery u doplňování i buňky doplňovací tabulky jsou teď očíslované i v zadání,
  takže se při opravování nemusí počítat řádky.
- **Řazení se po smazání otázky z banky rozešlo s klíčem.** Pořadí se míchá
  z obsahu otázky, ne z jejího identifikátoru, takže zmrazený test tiskne
  totéž zadání i klíč.
- **Náhled stránky byl v tmavém režimu nečitelný** (bílý papír s bílým písmem).
  Papír má vlastní tokeny a zůstává světlý i v tmavém rozhraní.
- **Dvě generování nad jedním tématem naráz** o sobě nevěděla a vyráběla
  duplicity. Druhé teď dostane srozumitelné odmítnutí.
- **Stejný soubor smí být ve dvou tématech.** Unikátnost obsahu platí v rámci
  tématu, ne napříč knihovnou — pracovní list používaný v 7. i 8. ročníku
  zůstane v obou.
- **Přesun a sloučení témat** přepočítají stav tématu a neponechají odkaz na
  duplicitu mimo téma, kvůli kterému se materiál navždy vynechával z generování.
- **Ovládání klávesnicí a telefon.** Prvky ukazují, kde je zaměření, a horní
  lišta se na úzké obrazovce zalomí, takže jsou všechny části dosažitelné.

### Změněno

- **Nastavení modelů jedinou proměnnou `AI_MODELS`** (žebříček
  `poskytovatel:model`, viz `apps/web/.env.example`). **Nezpětně
  kompatibilní:** proměnné `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_AUTH_TOKEN`
  a `OLLAMA_*` se už nečtou — kdo je má v `.env.local`, musí model přepsat do
  `AI_MODELS`. Správa staré proměnné pojmenuje.
- **Odebrána Ollama, Groq, Mistral, DeepInfra, Together i vlastní adresa
  (`custom`).** Zůstali tři poskytovatelé: Google Gemini, OpenRouter
  a Anthropic (jen s API klíčem).
- **Model generuje osm typů otázek** — výběr jedné i více možností,
  pravda/nepravda, krátkou i volnou odpověď, přiřazování dvojic, řazení
  a doplňování do textu. Zpočátku uměl jen tři, ostatní přibyly postupně.
  Doplňovací tabulku a popis obrázku psal nespolehlivě; zůstávají na ruční
  psaní nebo na `/otazky`.
- **Model dostává materiál po úsecích do 8 000 znaků** místo celého tématu
  naráz; úseky se vybírají rovnoměrně po tématu, další dogenerování bere jiné
  části a náhrada otázky vzniká z téže pasáže jako původní.

- **Skládání testu se vykresluje jen jednou.** Dřív byla v stránce zároveň
  úzká i široká podoba a jedna se schovávala, čímž vznikala zdvojená `id`
  filtrů a zdvojené ovládací prvky.

- **Body u vygenerované otázky se drží školního rozsahu.** Model občas nabídl
  i 25 bodů za jednu otázku; hodnoty nad deset se nahradí výchozím bodováním
  podle typu. Ručně zadané body zůstávají bez omezení.
- **Dvojice u přiřazovacích otázek** se ve schématu popisují polem o dvou
  prvcích místo `z.tuple`. Z tuple vzniká JSON schéma, které Gemini odmítne.
- **Redesign rozhraní.** Knihovna se teď prochází ve třech sloupcích vedle
  sebe — předměty a ročníky, témata vybraného ročníku a obsah tématu —, takže
  učitelka vidí souvislosti a nemusí se proklikávat zpátky. Skládání testu se
  rozpadlo na banku otázek, hrubý náhled stránky, který se skládá přímo v
  prohlížeči, a osnovu testu, kterou lze přeskládat přetažením. Sjednotil se i
  vzhled navigace a lišt oproti ploše s obsahem, takže je na první pohled
  jasné, kde je člověk v aplikaci a kde už pracuje s daty.
