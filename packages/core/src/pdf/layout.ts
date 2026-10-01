/**
 * Rendering helpers used by both the PDF and the paper page in the test
 * builder. They live here so screen and paper cannot disagree: blank numbering
 * in fill-ins, empty table cell marks and point formatting have a single
 * definition.
 *
 * This file must not touch `@react-pdf/renderer` — it is pulled into the
 * browser, where the PDF renderer does not belong.
 */

import type { PuzzleContent, PuzzleEntry } from '../schema/puzzle'
import { buildPuzzle, markedOffsets, puzzleProblems, type BuiltPuzzle, type CryptogramResult } from '../puzzle/index'

export { LETTERS, questionLabel } from './styles'
export { displayOrder } from './shuffle'
export { formatAnswer } from './answerKey'

/** Points with a decimal comma per Czech convention, integers without a trailing zero. */
export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1).replace('.', ',')
}

/**
 * Worksheet item dimensions in points. Read by the PDF renderer
 * (`WorksheetBlocks.tsx`) and the height estimate (`estimate.ts`) so the
 * preview breaks where the PDF does.
 */
export const WORKSHEET_LAYOUT = {
  /** Space above a short text. */
  textSpacing: 8,
  /** Space above a fun fact box and above a table. */
  blockSpacing: 10,
  /** Inner padding of the fun fact box. */
  funFactPadding: 6,
  /** Inner padding of a table cell. */
  cellPadding: 4,
  /** Minimum table row height — empty cells are filled in by hand. */
  rowMinHeight: 22,
} as const

/**
 * Fill-in question text with the blanks (`___`) replaced by a numbered line.
 * The key refers to the blanks by the same numbers, so answers need not be
 * matched by their order in the text.
 */
export function numberedBlanks(text: string): string {
  let blankNumber = 0
  return (
    text
      .replace(/___/g, () => {
        blankNumber += 1
        return ` (${blankNumber}) ______________ `
      })
      // Spaces around the mark keep it readable even where "___" sticks to a
      // word; this just cleans up the extra spaces that creates.
      .replace(/ {2,}/g, ' ')
      .replace(/ ([,.;:!?])/g, '$1')
      .trim()
  )
}

/**
 * Numbers of the empty cells of a fill-in table in row reading order; a
 * filled cell has `null`. Numbers match the order of answers in the key.
 */
export function tableBlankNumbers(rows: (string | null)[][]): (number | null)[][] {
  let blankNumber = 0
  return rows.map((row) => row.map((cell) => (cell ? null : (blankNumber += 1))))
}

/* ------------------------------------------------------------------------
 * Puzzle dimensions. Used by `PuzzleBody` (PDF), the `PaperPuzzle` preview
 * and the height estimate in `estimate.ts` — one definition so screen, paper
 * and pagination stay in sync.
 * --------------------------------------------------------------------- */

/**
 * Width the grid and cryptogram rows must fit into. A4 minus margins is
 * 493–521 pt for the built-in templates; there is headroom so the puzzle does
 * not push past the right margin even with a narrower-margin template.
 */
export const PUZZLE_USABLE_WIDTH = 480

/** Word search cell size by column count — a narrow grid gets bigger cells. */
export function cellSize(cols: number): number {
  return Math.max(11, Math.min(20, Math.floor(PUZZLE_USABLE_WIDTH / Math.max(cols, 1))))
}

/** Number of columns of the word list under the word search — on paper and on screen. */
export const WORD_LIST_COLUMNS = 3

/** Width of the cryptogram row number column ("10." must not touch the box). */
export const CRYPTOGRAM_NUMBER_WIDTH = 20

/** Cryptogram box — at least 18 pt for children, ideally 20 pt (about 7 mm). */
export const CRYPTOGRAM_BOX_MAX = 20
/** The box never shrinks below this, even for the longest word. */
export const CRYPTOGRAM_BOX_MIN = 12

/**
 * Cryptogram box size. The widest row (including the offset that lines up the
 * marked boxes) must fit the page width; boxes shrink only when it does not.
 */
export function cryptogramBoxSize(widthInBoxes: number): number {
  const fit = Math.floor((PUZZLE_USABLE_WIDTH - CRYPTOGRAM_NUMBER_WIDTH) / Math.max(widthInBoxes, 1))
  return Math.max(CRYPTOGRAM_BOX_MIN, Math.min(CRYPTOGRAM_BOX_MAX, fit))
}

/** Cryptogram row layout: offset of each row and box size. */
export function cryptogramLayout(result: CryptogramResult): {
  offsets: number[]
  widthInBoxes: number
  boxSize: number
} {
  // Row offsets so the marked boxes line up in one column.
  const offsets = markedOffsets(result.rows)
  const widthInBoxes = Math.max(...result.rows.map((row, i) => (offsets[i] ?? 0) + row.letters.length), 1)
  return { offsets, widthInBoxes, boxSize: cryptogramBoxSize(widthInBoxes) }
}

/**
 * Cryptogram phrase letters grouped by word, with the number of the row each
 * letter belongs to. When no word was found for a letter, `row` is false and
 * the box is printed pre-filled — otherwise the pupil would look for a row
 * that is not on the paper.
 */
export function cryptogramPhraseCells(result: CryptogramResult): { letter: string; number: number; row: boolean }[][] {
  const built = new Set(result.rows.map((row) => row.number))
  let number = 0
  return result.phraseWords.map((word) =>
    word.map((letter) => {
      number += 1
      return { letter, number, row: built.has(number) }
    }),
  )
}

/**
 * Words for the list under the word search — only those actually in the grid.
 * A word that did not fit would be searched for in vain.
 */
export function placedEntries(puzzle: PuzzleContent, built: BuiltPuzzle): PuzzleEntry[] {
  if (built.kind !== 'wordsearch') return puzzle.entries
  const placed = new Set(built.wordSearch.placements.map((placement) => placement.word))
  return puzzle.entries.filter((entry) => placed.has(entry.word))
}

/**
 * Puzzle for the given test variant. Variant B gets a different (still
 * deterministic) seed so the word search or cryptogram differs from the desk
 * neighbour's. If the other seed turns out worse (fewer placed words, more
 * problems), variant A is kept — a worse puzzle is not worth a different look.
 */
export function puzzleForVariant(puzzle: PuzzleContent, variant: 'A' | 'B'): PuzzleContent {
  if (variant === 'A') return puzzle
  const other = { ...puzzle, payload: { ...puzzle.payload, seed: `${puzzle.payload.seed}:B` } } as PuzzleContent
  const worse = puzzleProblems(buildPuzzle(other)).length > puzzleProblems(buildPuzzle(puzzle)).length
  return worse ? puzzle : other
}
