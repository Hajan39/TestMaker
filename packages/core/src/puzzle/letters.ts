/**
 * Puzzle letters.
 *
 * The rule is simple and holds for both the grid and the cryptogram: **one
 * letter = one cell**. Czech letters with carons and acutes go into a cell
 * with their diacritics ("Ř", "Ů"), so "RAK" and "ŘÁD" share no letter at
 * all — the pupil looks for exactly what is written in the list.
 *
 * The digraph `ch` is **deliberately not treated as one letter**: in the grid
 * it takes two cells, C and H. The Czech alphabet counts it as one letter, but
 * word searches are printed cell by cell and teachers and textbooks make them
 * this way — the pupil reads "c" and "h" in a row. If "ch" were one cell, the
 * solver would have to tell when the pair reads as a digraph and when as two
 * letters, and the grid gives no way to tell.
 */

/**
 * Characters that never go into a cell (spaces, hyphens, dashes, full stops,
 * quotes). The plain keyboard hyphen `-` is listed separately — the range
 * U+2010 to U+2015 covers only typographic dashes and hyphens.
 */
const SEPARATORS = /[\s ‐-―\-_.,;:!?'"()„“”‚‘’«»]+/u

/** Is this a letter that can be written into a cell? */
export function isPuzzleLetter(char: string): boolean {
  return /^\p{L}$/u.test(char)
}

/**
 * A word split into cells: upper case, no spaces or punctuation.
 * Also returns the characters that cannot go into the grid (digits, symbols) —
 * the caller reports them to the teacher instead of silently dropping them.
 */
export function splitWord(word: string): { letters: string[]; unusable: string[] } {
  const letters: string[] = []
  const unusable: string[] = []
  // Text pasted from macOS or a PDF is often decomposed (NFD): "ř" is "r"
  // plus a standalone caron. Without normalising it would become "R" and the
  // caron would end up among the unusable characters.
  for (const part of word.normalize('NFC').trim().split(SEPARATORS)) {
    // Locale-independent upper case: Czech is fine with the default rule.
    for (const char of part.toUpperCase()) {
      if (isPuzzleLetter(char)) letters.push(char)
      else if (char.trim()) unusable.push(char)
    }
  }
  return { letters, unusable }
}

/** The word's letters as cells; unusable characters are left out. */
export function puzzleLetters(word: string): string[] {
  return splitWord(word).letters
}

/**
 * The cryptogram phrase split into words and those into letters. Spaces never
 * go into cells, but the word split stays — the cryptogram is printed word by
 * word, otherwise the pupil could not read it once solved.
 */
export function phraseWords(phrase: string): string[][] {
  return splitPhrase(phrase).words
}

/**
 * The cryptogram phrase by words, including characters that cannot go into
 * the cells (digits, symbols). Those never make it into the cryptogram — the
 * caller must report them, otherwise "Rok 1348" would silently become "ROK".
 */
export function splitPhrase(phrase: string): { words: string[][]; unusable: string[] } {
  const words: string[][] = []
  const unusable: string[] = []
  for (const part of phrase.normalize('NFC').trim().split(/\s+/u)) {
    const split = splitWord(part)
    unusable.push(...split.unusable)
    if (split.letters.length > 0) words.push(split.letters)
  }
  return { words, unusable }
}

/** Letters without diacritics — for a comparison that ignores them. */
function baseLetters(text: string): string {
  return puzzleLetters(text).join('').normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * Does the clue give the answer away? Compared ignoring case and diacritics
 * ("KOREN" in the clue for "kořen" counts). For words of four letters or more
 * it is enough for a clue word to start with the answer ("lesníkem" for
 * "lesník"); shorter ones must match whole, otherwise "les" would give away
 * "lesklý" too.
 */
export function clueRevealsWord(word: string, clue: string): boolean {
  const answer = baseLetters(word)
  if (answer.length < 2) return false
  return clue
    .normalize('NFC')
    .split(/[^\p{L}\p{M}]+/u)
    .map(baseLetters)
    .some((token) => (answer.length >= 4 ? token.startsWith(answer) : token === answer))
}

/** What to tell the teacher when something went wrong. */
export interface PuzzleProblem {
  /** The word or letter the problem is about; empty for a general problem. */
  subject?: string
  /** A sentence that makes clear what to do about it. */
  message: string
}
