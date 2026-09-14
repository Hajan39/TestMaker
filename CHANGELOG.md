# Změny

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/).

## [Nevydáno]

### Přidáno

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
- **Generování otázek** přes Vercel AI SDK s vyměnitelným poskytovatelem
  (Claude, Ollama). Průběh se streamuje, už existující zadání dostane model
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
