# Změny

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/).

## [Nevydáno]

### Přidáno

- **Dogenerování na cílový počet.** U tématu i u hromadného generování jde
  místo „vytvoř N nových" zvolit „doplň téma na N otázek celkem"; zamítnuté
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

### Opraveno

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
