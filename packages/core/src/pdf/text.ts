import { t } from '../i18n'

/**
 * Text sanitisation before rendering into the PDF.
 *
 * The NotoSans/NotoSerif fonts shipped with the package do not cover all of
 * Unicode — the arrow "→", maths symbols (≈, ≠, ≤, ≥, √, ∞) or emoji/check
 * marks are missing. When an unsupported character reaches the PDF, react-pdf
 * replaces it with an empty "tofu" glyph, which looks like a printing error on
 * paper. Yet the teacher can type anything — e.g. an arrow chain in a biology
 * answer, and it ends up in the key too.
 *
 * We considered two options:
 * 1) add the missing glyphs to the TTF files — needs a font editor, risks
 *    breaking existing hinting/kerning and only covers characters we happen
 *    to think of;
 * 2) replace the character with a readable substitute before rendering.
 *
 * We chose (2): it is safe (does not touch fonts used by the rest of the app),
 * works for characters nobody thinks of today (generic fallback below), and
 * the result stays readable as plain text (e.g. when copying from the key PDF).
 */

/** Verified substitutes for characters that commonly appear in questions. */
const replacements = (): Record<string, string> => ({
  // No spaces around the substitute — teachers almost always surround the
  // arrow with spaces themselves ("a → b"); an extra space in the substitute
  // would create double spaces. Without a space in the original ("a→b") the
  // result is "a->b", still readable.
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
  '√': t('pdf:sanitize.squareRoot'), // √
  '∞': t('pdf:sanitize.infinity'), // ∞
  '∆': 'delta', // ∆
  '✓': t('pdf:sanitize.check'), // ✓
  '✔': t('pdf:sanitize.check'), // ✔
  '✗': t('pdf:sanitize.cross'), // ✗
  '✘': t('pdf:sanitize.cross'), // ✘
})

/**
 * Non-Latin characters the fonts provably contain (quotes, dashes, bullet,
 * ellipsis, degrees, fractions…) — left unchanged.
 */
const SAFE_EXTRA = new Set(
  [..."…‚„“‘’–—•™©®§¶½¼¾²³«»‹›′″×÷°€"].map((ch) => ch.codePointAt(0) as number),
)

/**
 * Replaces characters the chosen fonts cannot display with a readable
 * substitute. Called on every user-supplied text (question, options, header,
 * key…) right before rendering into the PDF.
 */
export function sanitizeText(text: string): string {
  let out = ''
  let map: Record<string, string> | undefined
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    // ASCII + Latin-1 + Latin Extended-A/B covers Czech and common European diacritics.
    if (cp < 0x250) {
      out += ch
      continue
    }
    map ??= replacements()
    const replacement = map[ch]
    if (replacement !== undefined) {
      out += replacement
      continue
    }
    if (SAFE_EXTRA.has(cp)) {
      out += ch
      continue
    }
    // Unknown character outside the supported range — a readable question mark beats an empty glyph.
    out += '?'
  }
  return out
}
