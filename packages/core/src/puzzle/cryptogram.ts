import type { PuzzleEntry } from '../schema/puzzle'
import { t } from '../i18n'
import { hashSeed, seededRandom, shuffled } from '../pdf/shuffle'
import { clueRevealsWord, splitPhrase, splitWord, type PuzzleProblem } from './letters'

/**
 * Cryptogram: the pupil fills in words from the clues and reads the hidden
 * phrase from the letters in the marked cells.
 *
 * Each row of the cryptogram stands for one letter of the phrase — as many
 * letters as the phrase has, that many rows and that many words are needed.
 * Which letter of the word gets the marked cell is drawn by a seeded random
 * generator, so the same puzzle prints the same way again.
 *
 * Whatever fails (no word for some letter, too few words) is reported in
 * `problems` — a silent cryptogram that spells a different phrase would only
 * be noticed by the children.
 */

export interface CryptogramRow {
  /** Row order = position of the letter in the phrase (from one). */
  number: number
  clue: string
  /** The word as the teacher wrote it. */
  word: string
  /** The word's letters as cells. */
  letters: string[]
  /** Which cell of the row belongs to the phrase (index into `letters`). */
  markedIndex: number
  /** The phrase letter in this row. */
  letter: string
}

export interface CryptogramResult {
  /** The hidden phrase as the teacher wrote it. */
  phrase: string
  /** The phrase by words and letters — printed cell by cell like this. */
  phraseWords: string[][]
  rows: CryptogramRow[]
  /** Words that found no place in the phrase. */
  unusedEntries: PuzzleEntry[]
  problems: PuzzleProblem[]
}

export interface CryptogramInput {
  entries: PuzzleEntry[]
  phrase: string
  seed: string
}

/** Builds a cryptogram. Never throws — returns problems in `problems`. */
export function buildCryptogram(input: CryptogramInput): CryptogramResult {
  const rand = seededRandom(hashSeed(`tajenka:${input.seed}:${input.phrase}`))
  const problems: PuzzleProblem[] = []

  const { words, unusable: phraseUnusable } = splitPhrase(input.phrase)
  const letters = words.flat()
  if (phraseUnusable.length > 0) {
    problems.push({
      message: t('puzzles:problems.phraseUnusable', { phrase: input.phrase, chars: phraseUnusable.join(' ') }),
    })
  }

  const usable: { entry: PuzzleEntry; letters: string[] }[] = []
  const seen = new Set<string>()
  for (const entry of input.entries) {
    const split = splitWord(entry.word)
    if (split.unusable.length > 0) {
      problems.push({
        subject: entry.word,
        message: t('puzzles:problems.cellUnusable', { word: entry.word, chars: split.unusable.join(' ') }),
      })
    }
    if (split.letters.length < 2) {
      problems.push({
        subject: entry.word,
        message: t('puzzles:problems.cryptogramWordTooShort', { word: entry.word }),
      })
      continue
    }
    if (!entry.clue.trim()) {
      problems.push({
        subject: entry.word,
        message: t('puzzles:problems.noClue', { word: entry.word }),
      })
      continue
    }
    // The same word in two rows could not be told apart at the board — the
    // pupil would know which clue they are solving only by the order.
    const key = split.letters.join('')
    if (seen.has(key)) {
      problems.push({
        subject: entry.word,
        message: t('puzzles:problems.cryptogramDuplicate', { word: entry.word }),
      })
      continue
    }
    seen.add(key)
    if (clueRevealsWord(entry.word, entry.clue)) {
      problems.push({
        subject: entry.word,
        message: t('puzzles:problems.clueReveals', { word: entry.word }),
      })
    }
    usable.push({ entry, letters: split.letters })
  }

  if (letters.length === 0) {
    problems.push({ message: t('puzzles:problems.noLetters') })
    return { phrase: input.phrase, phraseWords: words, rows: [], unusedEntries: usable.map((u) => u.entry), problems }
  }

  if (usable.length < letters.length) {
    problems.push({
      message: t('puzzles:problems.notEnoughWords', {
        phrase: input.phrase,
        letters: letters.length,
        words: usable.length,
      }),
    })
  }

  /**
   * Assigning words to letters is a bipartite matching (letter — a word that
   * contains it). A greedy choice would fail on a Czech phrase even where a
   * solution exists: a rare letter needs a word that a common letter has
   * already taken. So the maximum matching is found by augmenting paths
   * (Kuhn's algorithm) — when a letter stays unmatched, there really are too
   * few words, not bad luck in the order.
   *
   * The candidate order is shuffled by the seed, so the same words and seed
   * always give the same cryptogram, but two cryptograms over the same list
   * come out differently.
   */
  const candidates = letters.map((letter) =>
    shuffled(
      usable.flatMap((item, index) => (item.letters.includes(letter) ? [index] : [])),
      rand,
    ),
  )

  /** Which letter holds which word; −1 = the word is free. */
  const takenBy = new Array<number>(usable.length).fill(-1)

  function assign(letterIndex: number, visited: boolean[]): boolean {
    for (const wordIndex of candidates[letterIndex] as number[]) {
      if (visited[wordIndex]) continue
      visited[wordIndex] = true
      const holder = takenBy[wordIndex] as number
      if (holder === -1 || assign(holder, visited)) {
        takenBy[wordIndex] = letterIndex
        return true
      }
    }
    return false
  }

  // Letters with the fewest candidate words go first — fewer augmenting paths
  // are needed and the result does not depend on the letter order.
  const order = letters.map((_, i) => i).sort((a, b) => {
    const diff = (candidates[a] as number[]).length - (candidates[b] as number[]).length
    return diff !== 0 ? diff : a - b
  })

  const rowByIndex = new Map<number, CryptogramRow>()
  for (const letterIndex of order) {
    if (!assign(letterIndex, new Array<boolean>(usable.length).fill(false))) {
      const letter = letters[letterIndex] as string
      problems.push({
        subject: letter,
        message: t('puzzles:problems.letterUnmatched', { letter, position: letterIndex + 1 }),
      })
    }
  }

  const used = new Set<PuzzleEntry>()
  takenBy.forEach((letterIndex, wordIndex) => {
    if (letterIndex === -1) return
    const item = usable[wordIndex] as (typeof usable)[number]
    const letter = letters[letterIndex] as string
    const positions = item.letters.flatMap((value, i) => (value === letter ? [i] : []))
    used.add(item.entry)
    rowByIndex.set(letterIndex, {
      number: letterIndex + 1,
      clue: item.entry.clue,
      word: item.entry.word,
      letters: item.letters,
      markedIndex: positions[Math.floor(rand() * positions.length)] as number,
      letter,
    })
  })

  const rows: CryptogramRow[] = []
  for (let i = 0; i < letters.length; i += 1) {
    const row = rowByIndex.get(i)
    if (row) rows.push(row)
  }

  return {
    phrase: input.phrase,
    phraseWords: words,
    rows,
    unusedEntries: usable.filter((item) => !used.has(item.entry)).map((item) => item.entry),
    problems,
  }
}

/**
 * How many empty cells a row is indented by so the marked cells line up in
 * one column. That is how cryptograms are printed in textbooks and magazines:
 * the pupil reads it vertically instead of collecting it from scattered cells.
 */
export function markedOffsets(rows: CryptogramRow[]): number[] {
  const maxLeft = rows.reduce((max, row) => Math.max(max, row.markedIndex), 0)
  return rows.map((row) => maxLeft - row.markedIndex)
}

/** The phrase spelled by the marked letters — used to verify the cryptogram works out. */
export function readCryptogram(result: CryptogramResult): string {
  return result.rows.map((row) => row.letters[row.markedIndex] ?? '').join('')
}
