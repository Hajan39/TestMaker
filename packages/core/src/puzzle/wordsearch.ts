import type { PuzzleEntry } from '../schema/puzzle'
import { t } from '../i18n'
import { hashSeed, seededRandom, shuffled } from '../pdf/shuffle'
import { puzzleLetters, splitWord, type PuzzleProblem } from './letters'

/**
 * Word search: words are placed in the grid in eight directions, the rest is
 * filled with random letters.
 *
 * The draw is seeded (`seededRandom` from `pdf/shuffle`, the same generator as
 * for test variants), so the same words and seed always give the same grid —
 * a printed word search can be reproduced a month later unchanged.
 *
 * Whatever does not fit or cannot be placed is **never silently dropped**:
 * such a word ends up in both `problems` and `unplaced`, and the caller tells
 * the teacher before the puzzle is printed. Otherwise the pupil would look for
 * a word that is not in the grid.
 */

/** Direction names; the key-for-the-teacher label is `puzzles:directions.<name>`. */
export type WordSearchDirectionName =
  | 'right'
  | 'left'
  | 'down'
  | 'up'
  | 'downRight'
  | 'downLeft'
  | 'upRight'
  | 'upLeft'

export interface WordSearchDirection {
  /** Row step (−1 up, 0 horizontal, 1 down). */
  dr: -1 | 0 | 1
  /** Column step. */
  dc: -1 | 0 | 1
  /** Direction name for the answer key. */
  name: WordSearchDirectionName
}

/** The eight directions a word may run in. */
export const WORD_SEARCH_DIRECTIONS: readonly WordSearchDirection[] = [
  { dr: 0, dc: 1, name: 'right' },
  { dr: 0, dc: -1, name: 'left' },
  { dr: 1, dc: 0, name: 'down' },
  { dr: -1, dc: 0, name: 'up' },
  { dr: 1, dc: 1, name: 'downRight' },
  { dr: 1, dc: -1, name: 'downLeft' },
  { dr: -1, dc: 1, name: 'upRight' },
  { dr: -1, dc: -1, name: 'upLeft' },
]

export interface WordSearchPlacement {
  /** The word as the teacher wrote it. */
  word: string
  /** Letters in the cells (upper case, no spaces). */
  letters: string[]
  row: number
  col: number
  direction: WordSearchDirection
}

export interface WordSearchResult {
  cols: number
  rows: number
  /** The grid by rows; each cell is one upper-case letter. */
  grid: string[][]
  placements: WordSearchPlacement[]
  /** Words for which no place was found in the grid. */
  unplaced: string[]
  problems: PuzzleProblem[]
}

export interface WordSearchInput {
  entries: PuzzleEntry[]
  cols: number
  rows: number
  seed: string
  /**
   * Allowed directions; empty (or missing) = all eight. Used by tests and
   * possibly for an easier variant for younger pupils.
   */
  directions?: readonly WordSearchDirection[]
}

/** The shortest word worth looking for in a word search. */
const MIN_WORD_LETTERS = 2

/**
 * The Czech alphabet weighted by how often each letter appears in Czech
 * (roughly in percent; rare letters raised to 1). Used for the filler when the
 * words themselves give too few letters. Rare letters (Ď, Ť, Ň, Ů, Ó) are
 * included on purpose — otherwise a word with a caron would stand out in the
 * grid as the only letter of its kind and the pupil would find it without
 * searching.
 */
const CZECH_LETTER_WEIGHTS: Readonly<Record<string, number>> = {
  O: 9, E: 8, A: 7, N: 7, T: 6, S: 5, I: 5, V: 4, L: 4, R: 4, K: 4, D: 4,
  P: 3, M: 3, U: 3, Í: 3, Á: 2, Z: 2, J: 2, Y: 2, B: 2, C: 2, Ě: 2,
  H: 1, Ř: 1, Č: 1, Ž: 1, Š: 1, Ý: 1, É: 1, Ů: 1, Ú: 1, Ť: 1, Ď: 1, Ň: 1, Ó: 1, F: 1, G: 1,
}

/**
 * Filler letters for when the words alone are not enough. Each letter appears
 * as many times as its weight — a uniform draw from the array is a weighted one.
 */
const FILLER_FALLBACK: readonly string[] = Object.entries(CZECH_LETTER_WEIGHTS).flatMap(([letter, weight]) =>
  Array.from({ length: weight }, () => letter),
)

/**
 * Vulgar words the filler must never spell by accident in any direction.
 * Compared without diacritics (a child reads "PICA" too), so only base forms
 * are listed. The list is short on purpose: the point is that a word search
 * does not reach the class with a swear word, not a complete dictionary.
 */
export const WORD_SEARCH_BLOCKLIST: readonly string[] = [
  'PIČA',
  'KURVA',
  'HOVNO',
  'SRÁT',
  'SRAČKA',
  'SRÁČ',
  'ZMRD',
  'KUNDA',
  'PRCAT',
  'ČURAT',
  'ČURÁK',
  'CHCÁT',
  'PRDEL',
  'KOKOT',
  'ŠUKAT',
  'DEBIL',
]

/**
 * How many times the whole grid is laid out again when the letters of the
 * words (not the filler) spell a listed word a second time or a vulgar word.
 * Re-drawing the filler cannot fix such a match.
 */
const LAYOUT_ATTEMPTS = 8

/** How many rounds of filler re-draws are tried before giving up. */
const REROLL_ROUNDS = 200

/** A letter without diacritics. */
function baseLetter(letter: string): string {
  return letter.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Does the word fit at this spot? Overlap is allowed only on the same letter. */
function fits(
  grid: (string | null)[][],
  letters: string[],
  row: number,
  col: number,
  direction: WordSearchDirection,
): boolean {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  for (let i = 0; i < letters.length; i += 1) {
    const r = row + direction.dr * i
    const c = col + direction.dc * i
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false
    const cell = grid[r]?.[c]
    if (cell !== null && cell !== letters[i]) return false
  }
  return true
}

/** How many letters of this placement overlap already placed words. */
function overlapCount(
  grid: (string | null)[][],
  letters: string[],
  row: number,
  col: number,
  direction: WordSearchDirection,
): number {
  let overlap = 0
  for (let i = 0; i < letters.length; i += 1) {
    if (grid[row + direction.dr * i]?.[col + direction.dc * i] !== null) overlap += 1
  }
  return overlap
}

/** An occurrence of a target string in the grid: target index and cells (row × width + column). */
interface Occurrence {
  target: number
  cells: number[]
}

/**
 * All occurrences of the targets in the grid in all eight directions — the way
 * the pupil searches, regardless of which directions the words were laid in.
 */
function scanGrid(grid: string[][], targets: readonly string[][]): Occurrence[] {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const byFirst = new Map<string, number[]>()
  targets.forEach((target, index) => {
    const first = target[0]
    if (first === undefined) return
    const list = byFirst.get(first)
    if (list) list.push(index)
    else byFirst.set(first, [index])
  })

  const found: Occurrence[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const list = byFirst.get(grid[row]?.[col] as string)
      if (!list) continue
      for (const direction of WORD_SEARCH_DIRECTIONS) {
        for (const index of list) {
          const target = targets[index] as string[]
          const endR = row + direction.dr * (target.length - 1)
          const endC = col + direction.dc * (target.length - 1)
          if (endR < 0 || endR >= rows || endC < 0 || endC >= cols) continue
          const cells: number[] = []
          let ok = true
          for (let i = 0; i < target.length; i += 1) {
            const r = row + direction.dr * i
            const c = col + direction.dc * i
            if (grid[r]?.[c] !== target[i]) {
              ok = false
              break
            }
            cells.push(r * cols + c)
          }
          if (ok) found.push({ target: index, cells })
        }
      }
    }
  }
  return found
}

/** One layout of the grid: words, filler and whatever could not be fixed. */
interface Layout {
  grid: string[][]
  placements: WordSearchPlacement[]
  unplaced: string[]
  problems: PuzzleProblem[]
  /** Listed words that appear in the grid more than once (and could not be fixed). */
  repeated: Set<string>
  /** Vulgar words left in the grid. */
  vulgar: Set<string>
}

/** Builds a word search. Never throws — returns problems in `problems`. */
export function buildWordSearch(input: WordSearchInput): WordSearchResult {
  const { cols, rows, seed } = input
  const directions = input.directions && input.directions.length > 0 ? input.directions : WORD_SEARCH_DIRECTIONS

  const problems: PuzzleProblem[] = []
  const unplaced: string[] = []

  /** The longest line that fits in the grid — more letters never fit. */
  const longestPossible = Math.max(cols, rows)

  const candidates: { entry: PuzzleEntry; letters: string[] }[] = []
  const seen = new Set<string>()
  for (const entry of input.entries) {
    const { letters, unusable } = splitWord(entry.word)
    if (unusable.length > 0) {
      problems.push({
        subject: entry.word,
        message: t('puzzles:problems.gridUnusable', { word: entry.word, chars: unusable.join(' ') }),
      })
    }
    if (letters.length < MIN_WORD_LETTERS) {
      problems.push({
        subject: entry.word,
        message: t('puzzles:problems.wordsearchWordTooShort', { word: entry.word }),
      })
      unplaced.push(entry.word)
      continue
    }
    if (letters.length > longestPossible) {
      problems.push({
        subject: entry.word,
        message: t('puzzles:problems.wordTooLong', { word: entry.word, letters: letters.length, cols, rows }),
      })
      unplaced.push(entry.word)
      continue
    }
    const key = letters.join('')
    if (seen.has(key)) {
      problems.push({
        subject: entry.word,
        message: t('puzzles:problems.wordsearchDuplicate', { word: entry.word }),
      })
      continue
    }
    seen.add(key)
    candidates.push({ entry, letters })
  }

  // A word hidden inside another listed word (even backwards) will be found
  // in the grid more than once wherever it goes — that cannot be fixed, only
  // reported to the teacher.
  candidates.forEach((short, i) => {
    const word = short.letters.join('')
    for (const [j, long] of candidates.entries()) {
      if (i === j || long.letters.length < short.letters.length) continue
      const forward = long.letters.join('')
      const backward = [...long.letters].reverse().join('')
      const sameLength = long.letters.length === short.letters.length
      // A pair of equal length (ret × ter) is reported only once, on the later word.
      if (sameLength && j > i) continue
      if (sameLength ? backward === word : forward.includes(word) || backward.includes(word)) {
        problems.push({
          subject: short.entry.word,
          message: t(sameLength ? 'puzzles:problems.reversed' : 'puzzles:problems.hidden', {
            word: short.entry.word,
            other: long.entry.word,
          }),
        })
        break
      }
    }
  })

  // Longest words first: they have the least room in the grid, and placed
  // last they often no longer fit. Words of equal length keep the input order
  // (the sort is stable) — so **a different word order gives a different
  // grid** even with the same seed. That is fine: the same words in the same
  // order with the same seed always give the same grid, and reprinting a
  // month later relies on exactly that.
  const ordered = [...candidates].sort((a, b) => b.letters.length - a.letters.length)

  const blocklist = WORD_SEARCH_BLOCKLIST.map((word) => [...word].map(baseLetter))

  /** Lays out the grid once; `attempt` > 0 is a fresh try with a different draw. */
  function layout(attempt: number): Layout {
    // The first attempt draws as always, so earlier grids stay as they were.
    const base = `osmismerka:${seed}:${cols}x${rows}`
    const rand = seededRandom(hashSeed(attempt === 0 ? base : `${base}:${attempt}`))
    const layoutProblems: PuzzleProblem[] = []
    const layoutUnplaced: string[] = []
    const grid: (string | null)[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null))

    const placements: WordSearchPlacement[] = []
    for (const { entry, letters } of ordered) {
      // All possible spots, shuffled by the seed. The whole list is scanned, so
      // the word is placed not "almost always" at random but always when there
      // is room. A spot where the word would lie entirely on other words'
      // letters does not count: the pupil would not find "les" inside
      // "lesníku" as a word of its own, and the key would show two words on
      // the same cells.
      const spots: { row: number; col: number; direction: WordSearchDirection; overlap: number }[] = []
      for (const direction of directions) {
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            if (!fits(grid, letters, row, col, direction)) continue
            const overlap = overlapCount(grid, letters, row, col, direction)
            if (overlap < letters.length) spots.push({ row, col, direction, overlap })
          }
        }
      }

      if (spots.length === 0) {
        layoutUnplaced.push(entry.word)
        layoutProblems.push({
          subject: entry.word,
          message: t('puzzles:problems.noRoom', { word: entry.word }),
        })
        continue
      }

      // From the random order pick the spot with the largest overlap — words
      // interlock and the grid does not look like a list laid side by side.
      const shuffledSpots = shuffled(spots, rand)
      let best = shuffledSpots[0] as (typeof spots)[number]
      for (const spot of shuffledSpots) if (spot.overlap > best.overlap) best = spot

      for (let i = 0; i < letters.length; i += 1) {
        const r = best.row + best.direction.dr * i
        const c = best.col + best.direction.dc * i
        ;(grid[r] as (string | null)[])[c] = letters[i] as string
      }
      placements.push({ word: entry.word, letters, row: best.row, col: best.col, direction: best.direction })
    }

    // Filler: letters from the placed words, so the grid looks Czech.
    const pool = placements.flatMap((placement) => placement.letters)
    const filler = pool.length >= 8 ? [...new Set(pool)] : FILLER_FALLBACK
    const pick = () => filler[Math.floor(rand() * filler.length)] as string
    const filled = grid.map((row) => row.map((cell) => cell ?? pick()))

    // Word cells are fixed; only the filler may be re-drawn.
    const own = placements.map((placement) => {
      const cells = new Set<number>()
      for (let i = 0; i < placement.letters.length; i += 1) {
        cells.add((placement.row + placement.direction.dr * i) * cols + placement.col + placement.direction.dc * i)
      }
      return cells
    })
    const fixed = new Set(own.flatMap((cells) => [...cells]))
    const insideOnePlacement = (cells: number[]) => own.some((set) => cells.every((cell) => set.has(cell)))
    const targets = placements.map((placement) => placement.letters)

    /**
     * Occurrences that do not belong in the grid: a listed word anywhere but
     * its own place, or a vulgar word. An occurrence inside a single listed
     * word does not count — "les" in "lesníku" is reported above, and a vulgar
     * word that is part of a given word was written by the teacher herself.
     */
    function unwanted(): { occurrence: Occurrence; vulgar: boolean }[] {
      const bad: { occurrence: Occurrence; vulgar: boolean }[] = []
      for (const occurrence of scanGrid(filled, targets)) {
        const home = own[occurrence.target] as Set<number>
        if (occurrence.cells.every((cell) => home.has(cell))) continue
        if (insideOnePlacement(occurrence.cells)) continue
        bad.push({ occurrence, vulgar: false })
      }
      const baseGrid = filled.map((row) => row.map(baseLetter))
      for (const occurrence of scanGrid(baseGrid, blocklist)) {
        if (insideOnePlacement(occurrence.cells)) continue
        bad.push({ occurrence, vulgar: true })
      }
      return bad
    }

    // Filler re-draw: in each unwanted occurrence one filler cell is swapped.
    // The draw comes from the same generator, so the result stays seeded.
    let bad = unwanted()
    for (let round = 0; round < REROLL_ROUNDS; round += 1) {
      const touched = new Set<number>()
      for (const { occurrence } of bad) {
        const free = occurrence.cells.filter((cell) => !fixed.has(cell))
        if (free.length === 0 || free.some((cell) => touched.has(cell))) continue
        const cell = free[Math.floor(rand() * free.length)] as number
        touched.add(cell)
        const row = filled[Math.floor(cell / cols)] as string[]
        const before = row[cell % cols]
        let next = pick()
        for (let tries = 0; next === before && tries < 10; tries += 1) next = pick()
        row[cell % cols] = next
      }
      if (touched.size === 0) break
      bad = unwanted()
    }

    const repeated = new Set<string>()
    const vulgar = new Set<string>()
    for (const { occurrence, vulgar: isVulgar } of bad) {
      if (isVulgar) vulgar.add(WORD_SEARCH_BLOCKLIST[occurrence.target] as string)
      else repeated.add((placements[occurrence.target] as WordSearchPlacement).word)
    }
    return { grid: filled, placements, unplaced: layoutUnplaced, problems: layoutProblems, repeated, vulgar }
  }

  // When an unwanted match is spelled by the words' own letters, the filler
  // cannot help — the grid is laid out again with a different draw. The first
  // clean one wins, otherwise the one that fit the most words with the fewest
  // problems left.
  let chosen = layout(0)
  const score = (candidate: Layout) => [candidate.unplaced.length, candidate.repeated.size + candidate.vulgar.size]
  for (let attempt = 1; attempt < LAYOUT_ATTEMPTS && chosen.repeated.size + chosen.vulgar.size > 0; attempt += 1) {
    const next = layout(attempt)
    const [nextUnplaced, nextLeft] = score(next) as [number, number]
    const [chosenUnplaced, chosenLeft] = score(chosen) as [number, number]
    if (nextUnplaced < chosenUnplaced || (nextUnplaced === chosenUnplaced && nextLeft < chosenLeft)) chosen = next
  }

  problems.push(...chosen.problems)
  unplaced.push(...chosen.unplaced)
  for (const word of chosen.repeated) {
    problems.push({
      subject: word,
      message: t('puzzles:problems.repeated', { word }),
    })
  }
  for (const word of chosen.vulgar) {
    problems.push({
      message: t('puzzles:problems.vulgar', { word }),
    })
  }

  // `placements` is ordered by word length; the teacher and the key read the
  // list as it was written, so it is returned in input order.
  const placements = chosen.placements
  const orderOf = new Map(input.entries.map((entry, index) => [entry.word, index]))
  placements.sort((a, b) => (orderOf.get(a.word) ?? 0) - (orderOf.get(b.word) ?? 0))

  return { cols, rows, grid: chosen.grid, placements, unplaced, problems }
}

/**
 * Finds a word in a finished grid — all eight directions. Returns every place
 * the word lies. Used for checks (and tests): what gets printed must be findable.
 */
export function findWord(grid: string[][], word: string): WordSearchPlacement[] {
  const letters = puzzleLetters(word)
  if (letters.length === 0) return []
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const found: WordSearchPlacement[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      for (const direction of WORD_SEARCH_DIRECTIONS) {
        let ok = true
        for (let i = 0; i < letters.length; i += 1) {
          const r = row + direction.dr * i
          const c = col + direction.dc * i
          if (r < 0 || r >= rows || c < 0 || c >= cols || grid[r]?.[c] !== letters[i]) {
            ok = false
            break
          }
        }
        if (ok) found.push({ word, letters, row, col, direction })
      }
    }
  }
  return found
}

/**
 * A grid showing only the letters of the hidden words — the teacher's key.
 * All other cells are empty, so the solution is visible at a glance.
 */
export function solutionGrid(result: WordSearchResult): (string | null)[][] {
  const marked: (string | null)[][] = Array.from({ length: result.rows }, () =>
    Array.from({ length: result.cols }, () => null),
  )
  for (const placement of result.placements) {
    for (let i = 0; i < placement.letters.length; i += 1) {
      const r = placement.row + placement.direction.dr * i
      const c = placement.col + placement.direction.dc * i
      ;(marked[r] as (string | null)[])[c] = placement.letters[i] as string
    }
  }
  return marked
}

/** Where a word lies — one line of the key ("STONEK: řádek 3, sloupec 5, vpravo dolů"). */
export function describePlacement(placement: WordSearchPlacement): string {
  return t('puzzles:placement', {
    word: placement.word,
    row: placement.row + 1,
    col: placement.col + 1,
    direction: t(`puzzles:directions.${placement.direction.name}`),
  })
}
