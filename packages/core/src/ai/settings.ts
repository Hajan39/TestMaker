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
} as const
