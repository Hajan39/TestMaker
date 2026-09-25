---
name: otazky
description: Napíše otázky do písemky z materiálů jednoho tématu TestMakeru a uloží je jako soubor k nahrání do tématu. Použij, když majitel řekne /otazky, pošle soubor stažený tlačítkem „Stáhnout materiály" nebo chce otázky přes Claude Code místo generování v aplikaci.
---

# Otázky do tématu z Claude Code

Vstupem je textový soubor z tématu (tlačítko „Stáhnout materiály" na stránce
tématu). Hlavička souboru (`# Předmět`, `# Ročník`, `# Téma`, případně
`# Otázky, které už v tématu jsou`) říká, pro koho píšeš a co už existuje.

Skripty `otazky:pravidla` a `otazky:over` běží přes `pnpm --filter @testmaker/web …`,
tedy ve složce `apps/web`. Cesty k souborům jim proto předávej vždy
**absolutní** — relativní by se hledala v `apps/web`, ne vedle souboru
od majitele.

1. Zeptej se na cestu k souboru, pokud ji majitel nedal. Přečti ho celý.
2. Zeptej se, kolik otázek a jakou obtížnost chce, pokud to neřekl
   (výchozí 10 otázek, promíchaná obtížnost 1–3).
3. Spusť `pnpm --filter @testmaker/web otazky:pravidla "<ročník z hlavičky>"`
   a řiď se vypsanými pravidly i tvarem. Jsou to tatáž pravidla, podle kterých
   generuje aplikace.
4. Vyber typy podle látky — smíš použít všechny kromě `label_image`
   (přiřazování na pojmy a jejich význam, řazení na postupy a vývoj).
   Ke každé otázce vyplň `evidence.quote` doslovnou větou ze souboru.
5. Než soubor zapíšeš, přečti každou otázku očima žáka daného ročníku:
   rozumí zadání napoprvé? Je čeština přirozená a bez chyb? Je správná
   odpověď jen jedna a stojí v materiálu? Co neprojde, přepiš.
6. Zapiš `<název zdroje>.otazky.json` vedle zdrojového souboru
   ve tvaru `{ "questions": [ … ] }`.
7. Spusť `pnpm --filter @testmaker/web otazky:over </absolutní/cesta/zdroj.txt> </absolutní/cesta/otazky.json>`.
   Odmítnuté otázky oprav (nejčastěji citace, která v textu doslova není)
   a kontrolu opakuj, dokud neskončí `odmítnuto: 0`.
8. Řekni majiteli, kde soubor je, a že ho nahraje na stránce tématu tlačítkem
   „Nahrát otázky".

Na databázi (`apps/web/local.db`) nikdy nesahej — soubor se do aplikace
dostává jedině nahráním v rozhraní.
