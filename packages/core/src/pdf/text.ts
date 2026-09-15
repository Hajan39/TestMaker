/**
 * Sanitizace textu před vykreslením do PDF.
 *
 * Fonty NotoSans/NotoSerif, které balíček dodává, nepokrývají celý Unicode —
 * chybí třeba šipka „→“, matematické symboly (≈, ≠, ≤, ≥, √, ∞) nebo
 * emotikony/fajfky. Když se nepodporovaný znak dostane do PDF, react-pdf ho
 * nahradí prázdným „pahýlovým“ glyfem, na papíře to vypadá jako tisková
 * chyba. Učitelka přitom může napsat cokoli — třeba „nos → nosohltan →
 * hrtan“ v odpovědi z přírodopisu, a stane se to i v klíči.
 *
 * Zvažovali jsme dvě cesty:
 * 1) doplnit chybějící glyfy do TTF souborů — vyžaduje editor fontů, riziko
 *    poškození existujícího hintingu/kerningu a řeší jen znaky, na které si
 *    zrovna vzpomeneme;
 * 2) nahradit znak čitelnou náhradou ještě před vykreslením.
 *
 * Zvolili jsme (2): je to bezpečné (nesahá na fonty, které používá i zbytek
 * aplikace), funguje i pro znaky, které dnes nikoho nenapadnou (obecný
 * fallback níže), a výsledek zůstává čitelný i jako prostý text (např. při
 * kopírování z PDF klíče).
 */

/** Ověřené náhrady pro znaky, které se v zadáních běžně objevují. */
const REPLACEMENTS: Record<string, string> = {
  // Bez mezer kolem náhrady — učitelé šipku téměř vždy obklopují mezerami
  // sami („nos → nosohltan“), s mezerou navíc v náhradě by vznikaly dvojité
  // mezery. Bez mezery v originále („nos→nosohltan“) vyjde „nos->nosohltan“,
  // pořád čitelné.
  '→': '->', // →
  '←': '<-', // ←
  '↔': '<->', // ↔
  '⇒': '=>', // ⇒
  '⇐': '<=', // ⇐
  '≈': '~', // ≈
  '≠': '!=', // ≠
  '≤': '<=', // ≤
  '≥': '>=', // ≥
  '±': '+/-', // ±
  '√': 'odmocnina ', // √
  '∞': 'nekonečno', // ∞
  '∆': 'delta', // ∆
  '✓': '[ano]', // ✓
  '✔': '[ano]', // ✔
  '✗': '[ne]', // ✗
  '✘': '[ne]', // ✘
}

/**
 * Znaky mimo latinku, které fonty prokazatelně obsahují (uvozovky, pomlčky,
 * odrážka, výpustka, stupně, zlomky…) — necháváme beze změny.
 */
const SAFE_EXTRA = new Set(
  [..."…‚„“‘’–—•™©®§¶½¼¾²³«»‹›′″×÷°€"].map((ch) => ch.codePointAt(0) as number),
)

/**
 * Nahradí znaky, které vybrané fonty neumí zobrazit, čitelnou náhradou.
 * Volá se na každém textu pocházejícím od uživatele (zadání, možnosti,
 * hlavička, klíč…) těsně před vykreslením do PDF.
 */
export function sanitizeText(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    // ASCII + Latin-1 + Latin Extended-A/B pokrývá češtinu i běžnou evropskou diakritiku.
    if (cp < 0x250) {
      out += ch
      continue
    }
    const replacement = REPLACEMENTS[ch]
    if (replacement !== undefined) {
      out += replacement
      continue
    }
    if (SAFE_EXTRA.has(cp)) {
      out += ch
      continue
    }
    // Neznámý znak mimo podporovaný rozsah — radši čitelný otazník než prázdný pahýl.
    out += '?'
  }
  return out
}
