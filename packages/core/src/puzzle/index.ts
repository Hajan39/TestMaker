import type { PuzzleContent } from '../schema/puzzle'
import { buildCryptogram, type CryptogramResult } from './cryptogram'
import type { PuzzleProblem } from './letters'
import { buildWordSearch, type WordSearchResult } from './wordsearch'

export * from './letters'
export * from './wordsearch'
export * from './cryptogram'

/**
 * Hotový hlavolam: to, co se opravdu vytiskne. Papír i náhled na obrazovce
 * berou obojí odsud, aby nemohly ukázat každý něco jiného.
 */
export type BuiltPuzzle =
  | { kind: 'wordsearch'; wordSearch: WordSearchResult }
  | { kind: 'cryptogram'; cryptogram: CryptogramResult }

/** Složí hlavolam z uloženého zadání. Čistá funkce: týž vstup, týž výstup. */
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

/** Potíže hotového hlavolamu — jedno místo pro rozhraní i pro tisk. */
export function puzzleProblems(built: BuiltPuzzle): PuzzleProblem[] {
  return built.kind === 'wordsearch' ? built.wordSearch.problems : built.cryptogram.problems
}
