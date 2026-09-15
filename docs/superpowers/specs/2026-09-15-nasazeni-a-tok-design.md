# Nasaditelná verze a průchodnost toku

Datum: 2026-09-15

## Proč

Aplikace je postavená podle plánu, ale nikdo s ní ještě neprošel celý postup na
skutečných materiálech. Než přibude cokoli z ROADMAPu, musí platit dvoje:
aplikace jde vystavit učitelce, aniž by byla otevřená komukoli s odkazem, a
místa, kde se učitelka nejspíš zasekne, musí být průchodná.

Cílové prostředí je dnes vývojářův počítač, výhledově Vercel + Turso nebo
self-hosting na Synology. Všechno níže musí fungovat v obou — `@libsql/client`
to umožňuje už dnes, rozhodnutí se tím nezavírá.

Obrázky v otázkách, OCR skenů, štítky RVP a online varianta testu se odkládají,
dokud neproběhne jedna reálná písemka od materiálů po tisk.

## Část A — nasaditelná verze

### A1. Přihlášení jedním heslem

Dnes nemá aplikace žádnou ochranu. Na veřejné URL to znamená otevřenou banku
otázek a cizí účet u Anthropicu.

`apps/web/src/middleware.ts` chrání všechny cesty kromě `/login`, statických
souborů a cron endpointu. Přihlášení je jedno sdílené heslo v `APP_PASSWORD`.
Po odeslání formuláře se nastaví `httpOnly` cookie, jejíž hodnota je
HMAC-SHA256 z `APP_PASSWORD` klíčem `AUTH_SECRET`; middleware ji ověřuje přes
Web Crypto, které v Edge runtime běží. Odhlášení cookie smaže.

Uživatelé, role ani oprávnění se nezavádějí. Víc učitelů je samostatná položka
ROADMAPu a přijde, až budou opravdu dva.

### A2. Vzorový soubor s nastavením

`apps/web/.env.example` v repozitáři chybí, přestože na něj README odkazuje —
rychlý start dnes nedoběhne. Soubor vznikne s položkami `DATABASE_URL`,
`DATABASE_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `APP_PASSWORD`, `AUTH_SECRET`,
`CRON_SECRET` a s poznámkou u každé, k čemu je a co se stane, když chybí.
README se opraví podle skutečnosti.

### A3. Fronta generování bez otevřeného prohlížeče

`drainQueue` volá `POST /api/jobs/run` ve smyčce z prohlížeče. Zavřený panel
uprostřed dávky znamená nedogenerovaná témata a úlohu, která zůstane ve stavu
`running` navždy.

`/api/jobs/run` dostane variantu `GET`, kterou pouští plánovač a která se ověří
hlavičkou s `CRON_SECRET`. Na Vercelu ji spouští `vercel.json` s cronem po
minutě, na Synology `curl` v Task Scheduleru — jeden endpoint pro obě
prostředí. Před výběrem úlohy runner vrátí do stavu `queued` každou úlohu, která
je `running` déle než deset minut.

Dnešní volání z prohlížeče zůstává: učitelka, která čeká na výsledek, ho chce
hned, ne za minutu.

### A4. Záloha knihovny

Celá práce visí na jedné databázi a nic ji odtud nedostane.

`GET /api/export` vrátí jeden JSON s předměty, ročníky, tématy, materiály,
otázkami, testy a šablonami. `POST /api/export` tentýž soubor nahraje zpět;
záznamy se dohledávají podle `id`, existující se přepíší. Odkaz na stažení je
na přehledu.

Automatické ani přírůstkové zálohy nevznikají — ruční soubor stačí, dokud
databázi používá jeden člověk.

## Část B — průchodnost toku

### B1. Náhled importu před uložením

Extrakce v prohlížeči vyrobí položky se `subject`, `grade` a `topic` odhadnutými
z cesty (`parsePath`) a rovnou je pošle na `/api/materials`. Učitelka výsledek
uvidí, až když je v databázi; její skutečná struktura složek se přitom se
vzorem Předmět → Ročník → Téma potká jen náhodou. Tohle je nejpravděpodobnější
místo prvního záseku.

Mezi extrakci a odeslání se vloží náhled: tabulka souborů seskupená podle
odhadnutého tématu, sloupce Předmět, Ročník a Téma editovatelné po skupině,
zaškrtávátko „neimportovat“ u řádku i skupiny. Dávka odejde teprve tlačítkem
„Importovat“. Parametr `?group=0` zůstává, ruční úprava názvů ho přebíjí.

Přetahování souborů mezi skupinami ani ukládání mapovacích pravidel pro příští
import se nedělá.

### B2. Rychlé schvalování otázek

Schvalování je nejčastější činnost v aplikaci a nemá vlastní obrazovku: otázky
se procházejí v tématu ve výpisu. U dvanácti otázek na téma a desítek témat je
to hlavní dřina celého postupu.

Nová stránka `/review` ukazuje jednu otázku přes celou obrazovku, frontou jsou
všechny otázky ve stavu `draft` napříč knihovnou, volitelně zúžené na jedno
téma. Klávesy: `A` schválit, `Z` zamítnout, `E` otevřít stávající
`QuestionEditor`, šipky posun frontou. Změny stavu jdou přes `PUT
/api/questions`, které hromadnou změnu umí už dnes — nové je jen rozhraní.

Tlačítko „schválit vše“ ani statistiky sezení nevznikají.

### B3. Regenerace jedné otázky

Když je otázka špatná, dnes zbývá přepsat ji ručně.

`POST /api/questions/regenerate` s `id` najde téma otázky a vygeneruje jednu
náhradu téhož typu a obtížnosti. Do promptu jdou existující otázky tématu
včetně té zamítané jako text, kterému se má model vyhnout. Původní otázka se
označí `rejected`, nová vznikne jako `draft`. Tlačítko je v `/review` i ve
výpisu tématu.

Generování několika variant na výběr ani pole „proč se mi to nelíbí“ jako vstup
promptu se nepřidává.

### B4. Stav otázky se začne používat

`loadPickerTopics` stav otázky vůbec nečte, takže do testu jde vybrat i otázka
označená jako zamítnutá — schvalování dnes nemá žádný účinek. Načtou se jen
otázky ve stavu `approved`. Migrace překlopí všechny existující `draft` na
`approved`, aby dnešní banka nezmizela z výběru.

## Ověřování

Vedle `pnpm test`, `pnpm typecheck` a `pnpm build`:

- ověření podpisu cookie a odmítnutí cizí hodnoty,
- návrat úlohy ze stavu `running` do `queued` po vypršení limitu,
- export a import knihovny tam a zpět se shodným výsledkem,
- sestavení skupin pro náhled importu z ukázkových cest,
- fronta obrazovky schvalování nad smíšenými stavy,
- regenerace otázky proti podvrženému poskytovateli, jako to dělá dnešní
  `ai.test.ts`.

## Pořadí

A2 a A1 jsou předpokladem vystavení. A3 a A4 dávají smysl hned po nich. Část B
je nezávislá na A a v ní B4 předchází B2, protože bez účinku stavu nemá
schvalovací obrazovka co ovlivňovat.
