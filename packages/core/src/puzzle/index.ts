import type { PuzzleContent } from '../schema/puzzle'
import { buildCryptogram, type CryptogramResult } from './cryptogram'
import type { PuzzleProblem } from './letters'
import { buildWordSearch, type WordSearchResult } from './wordsearch'

export * from './letters'
export * from './wordsearch'
export * from './cryptogram'

/**
 * A built puzzle: what actually gets printed. Both the paper and the on-screen
 * preview take it from here so they can never show different things.
 */
export type BuiltPuzzle =
  | { kind: 'wordsearch'; wordSearch: WordSearchResult }
  | { kind: 'cryptogram'; cryptogram: CryptogramResult }

/** Builds a puzzle from its stored definition. Pure: same input, same output. */
export function buildPuzzle(puzzle: PuzzleContent): BuiltPuzzle {
  if (puzzle.kind === 'wordsearch') {
    return {
      kind: 'wordsearch',
      wordSearch: buildWordSearch({
        entries: puzzle.entries,
        cols: puzzle.payload.cols,
        rows: puzzle.payload.rows,
        seed: puzzle.payload.seed,
      }),
    }
  }
  return {
    kind: 'cryptogram',
    cryptogram: buildCryptogram({
      entries: puzzle.entries,
      phrase: puzzle.payload.phrase,
      seed: puzzle.payload.seed,
    }),
  }
}

/** Problems of a built puzzle — one place for both the UI and printing. */
export function puzzleProblems(built: BuiltPuzzle): PuzzleProblem[] {
  return built.kind === 'wordsearch' ? built.wordSearch.problems : built.cryptogram.problems
}
