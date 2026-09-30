/**
 * Nastavení generování na jednom místě. Co se tu změní, platí pro otázky
 * i hlavolamy, v aplikaci i ve skriptech. Model a klíče se nastavují
 * v prostředí (`AI_MODELS`, viz `.env.example`), ne tady.
 */
export const AI_SETTINGS = {
  /** Žebříček, když `AI_MODELS` chybí. */
  defaultModels: ['google:gemini-flash-latest'],
  /** Kolikrát AI SDK samo zopakuje neúspěšné volání jednoho modelu. */
  maxRetries: 2,
  /**
   * Nejdelší úsek materiálu v jednom volání (znaky). S úsekem o pár stranách
   * model pracuje přesně; se stovkou stran se ztratí a začne vymýšlet.
   */
  maxCharsPerCall: 8_000,
  /**
   * Otázek v jednom volání. Model vrací dávku jako jeden objekt — čím větší,
   * tím víc práce padne, když se u jedné otázky netrefí do tvaru.
   *
   * Určuje i počet úseků materiálu: generování jich vybere jen tolik, kolik
   * je potřeba plných dávek (10 otázek = 2 úseky = 2 volání). Víc úseků po
   * jedné otázce by pokrylo víc látky, ale stálo by až pětkrát víc volání —
   * a bezplatné tarify mají denní limit na počet volání, ne na otázky. Že se
   * témata nepokrývají pořád od začátku, zajišťuje posun výběru při každém
   * dalším dogenerování (`pickChunks`).
   */
  questionsPerCall: 5,
  /**
   * Kolik zadání se vejde do seznamu „těmhle otázkám se vyhni". Seznam se
   * ořezává, aby prompt nenarůstal do nekonečna u témat s dlouhou historií
   * generování — 80 položek stačilo, dokud šly první ty starší z databáze.
   * Volající dává napřed nově vzniklé otázky z běžícího generování (viz
   * generate.ts), takže při tématu s desítkami existujících otázek se do
   * limitu nevešly ani ty čerstvé z právě běžící dávky. Podle téhož čísla si
   * web načítá existující otázky (`loadAvoidPrompts`) — jinak by vybíral víc,
   * než se do promptu vejde.
   */
  avoidLimit: 80,
  /** Delší zadání v seznamu k vyhnutí se ořízne — k odlišení stačí začátek. */
  avoidItemMaxLength: 100,
  /**
   * Nejvíc bodů, které se od modelu převezmou u volné odpovědi a kresby
   * (ostatní typy body počítají samy, viz `pointsByScope`). Víc by znamenalo
   * hodně rozsáhlou odpověď, jakou písemka na základní škole nemívá.
   */
  maxAiPoints: 5,
  /** Nejkratší kus citace, který má smysl v materiálu hledat; kratší by se našel kdekoli. */
  minEvidencePart: 8,
  /**
   * Slova do hlavolamu (`puzzleWords.ts`). Meze slova i nápovědy, které dává
   * schéma hlavolamu (`puzzleEntrySchema`) a velikost mřížky, se berou odtamtud;
   * tady jsou jen čísla samotného generování.
   */
  puzzleWords: {
    /**
     * Kolik znaků materiálů se modelu pošle nejvýš. Na slovní zásobu to stačí;
     * když je materiálů víc, rozpočet se dělí mezi ně (`fitMaterials`), aby
     * poslední soubory podle abecedy nevypadly celé.
     */
    materialChars: 60_000,
    /** Úsek, po kterém se z dlouhého materiálu vybírá rovnoměrně napříč textem. */
    materialChunkChars: 2_000,
    /** Kratší slovo se v osmisměrce najde náhodou kdekoli. */
    minLetters: 3,
    /** Tajenka nemá mřížku; delší řádek se nevejde na šířku stránky. */
    cryptogramMaxLetters: 14,
    /** Délka nápovědy, o kterou se model žádá; tvrdou mez dává schéma. */
    clueTargetLength: 120,
    /** Nápověda, která by po zkrácení byla kratší, se radši zahodí. */
    clueMinTrimmedLength: 25,
    /** Kolik prvních písmen slova se hledá v nápovědě jako prozrazený kořen. */
    clueRootLetters: 5,
    /**
     * Dvě slova, z nichž jedno je začátkem druhého a liší se nejvýš o tolik
     * písmen, jsou tvary téhož pojmu (kořen/kořeny, Ústava/ustava).
     */
    nearDuplicateExtraLetters: 2,
    /** Nejvíc slov na jedno volání — víc jich hlavolam ani nepojme. */
    maxWordsPerCall: 40,
    /**
     * U tajenky se žádá o víc slov, než kolik chybí písmen: část slov
     * se zahodí (nenajdou se v materiálu, prozradí se v nápovědě) a párování
     * písmen se slovy potřebuje rezervu. Chybějících písmen × tenhle poměr,
     * aspoň `cryptogramMinExtraWords` navíc.
     */
    cryptogramExtraWordsRatio: 0.5,
    cryptogramMinExtraWords: 3,
  },
  /** Pracovní listy (`worksheet.ts`). Tvar tabulky a jejích mezí dává schéma v core. */
  worksheet: {
    /**
     * Kolik znaků materiálů tématu se modelu pošle nejvýš. List je jedno
     * volání; víc textu by model stejně nepokryl a volání by zbytečně zdražilo.
     */
    materialChars: 40_000,
    /** Úsek, po kterém se z dlouhého materiálu vybírá rovnoměrně napříč textem. */
    materialChunkChars: 2_000,
    /** Nejdelší vlastní text, který učitelka do zadání vloží. */
    ownTextMax: 20_000,
    /** Nejdelší pokyn k listu. */
    instructionsMax: 1_000,
    /**
     * Nejdelší krátký text nebo fun fact od modelu (znaky). Delší se vyřadí,
     * ne ořízne — useknutá věta nedává smysl. Ruční úpravu to neomezuje.
     */
    textMax: 600,
    /** Méně obsahových položek (bez nadpisů a pokynů) už na list nestačí. */
    minItems: 3,
    /** Víc položek se na list pro jednu hodinu nevejde; přebytek se zahodí. */
    maxItems: 20,
  },
} as const
