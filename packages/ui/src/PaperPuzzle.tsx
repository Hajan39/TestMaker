import type { PuzzleContent } from '@testmaker/core/schema'
import { puzzleInstructions } from '@testmaker/core/schema'
import { buildPuzzle, describePlacement, markedOffsets, solutionGrid, type BuiltPuzzle } from '@testmaker/core/puzzle'
import { cn } from './cn'

/**
 * Hlavolam vykreslený tak, jak se vytiskne — mřížka osmisměrky se seznamem
 * slov, nebo řádky tajenky s políčky.
 *
 * Vzorem je `PuzzleBody.tsx` z `packages/core/src/pdf`, ale to podstatné je,
 * že obě strany berou hotový hlavolam z jednoho a téhož výpočtu
 * (`buildPuzzle` v `@testmaker/core/puzzle`). Náhled se tak nemůže rozejít
 * s papírem: kde leží slovo na obrazovce, tam leží i na papíře.
 *
 * Rozměry se zapisují v bodech PDF (pt) přes `--paper-pt`, kterou nastavuje
 * `PaperSheet` — stejně jako u `PaperQuestion`.
 */

const pt = (value: number): string => `calc(${value} * var(--paper-pt, 1.3333px))`

/** Táž šířka, do které mřížku vejde tisk (`cellSize` v core/pdf). */
const USABLE_WIDTH = 480

export function cellSize(cols: number): number {
  return Math.max(11, Math.min(20, Math.floor(USABLE_WIDTH / Math.max(cols, 1))))
}

export function PaperPuzzle({
  puzzle,
  built = buildPuzzle(puzzle),
  solved = false,
  showTitle = true,
  className,
}: {
  puzzle: PuzzleContent
  /** Hotový hlavolam; když se nepředá, spočítá se z obsahu. */
  built?: BuiltPuzzle
  /** Vykreslit řešení pro učitelku místo prázdného zadání. */
  solved?: boolean
  showTitle?: boolean
  className?: string
}) {
  return (
    <div data-slot="paper-puzzle" className={cn('break-inside-avoid', className)}>
      {showTitle ? (
        <>
          <h4 className="font-bold" style={{ fontSize: pt(12) }}>
            {puzzle.title}
          </h4>
          <p className="italic opacity-80">{puzzleInstructions(puzzle)}</p>
        </>
      ) : null}
      {built.kind === 'wordsearch' ? (
        <WordSearchView puzzle={puzzle} built={built} solved={solved} />
      ) : (
        <CryptogramView built={built} solved={solved} />
      )}
    </div>
  )
}

function WordSearchView({
  puzzle,
  built,
  solved,
}: {
  puzzle: PuzzleContent
  built: Extract<BuiltPuzzle, { kind: 'wordsearch' }>
  solved: boolean
}) {
  const result = built.wordSearch
  const size = cellSize(result.cols)
  const grid = solved ? solutionGrid(result) : result.grid
  const showClues = puzzle.kind === 'wordsearch' && puzzle.payload.showClues

  return (
    <div style={{ marginTop: pt(6) }}>
      <div className="mx-auto w-fit" data-slot="puzzle-grid">
        {grid.map((row, r) => (
          <div key={r} className="flex">
            {row.map((cell, c) => (
              <span
                key={c}
                className="flex items-center justify-center border border-paper-line"
                style={{ width: pt(size), height: pt(size), fontSize: pt(size * 0.58) }}
              >
                {cell ?? ''}
              </span>
            ))}
          </div>
        ))}
      </div>

      <ul
        className="mt-2 grid grid-cols-2 gap-x-3 sm:grid-cols-3"
        style={{ fontSize: pt(9) }}
        data-slot="puzzle-words"
      >
        {puzzle.entries.map((entry, i) => (
          <li key={i} className="truncate">
            {entry.word.toUpperCase()}
            {showClues ? ` – ${entry.clue}` : ''}
          </li>
        ))}
      </ul>

      {solved ? (
        <ul className="mt-2 opacity-70" style={{ fontSize: pt(8) }}>
          {result.placements.map((placement, i) => (
            <li key={i}>{describePlacement(placement)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function CryptogramView({
  built,
  solved,
}: {
  built: Extract<BuiltPuzzle, { kind: 'cryptogram' }>
  solved: boolean
}) {
  const result = built.cryptogram
  const box = 14
  // Odsazení řádků, aby vyznačená políčka stála pod sebou — stejně jako na papíře.
  const offsets = markedOffsets(result.rows)
  const gridWidth = Math.max(...result.rows.map((row, i) => (offsets[i] ?? 0) + row.letters.length), 1) * box

  return (
    <div style={{ marginTop: pt(6) }} data-slot="puzzle-rows">
      <div style={{ marginBottom: pt(8) }}>
        <div style={{ fontSize: pt(9), marginBottom: pt(3) }}>Tajenka:</div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {result.phraseWords.map((word, w) => (
            <span key={w} className="flex">
              {word.map((letter, i) => (
                <span
                  key={i}
                  className="flex items-center justify-center border border-paper-line"
                  style={{ width: pt(box), height: pt(box), fontSize: pt(box * 0.58) }}
                >
                  {solved ? letter : ''}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <div style={{ fontSize: pt(9), marginBottom: pt(3) }}>Doplňovačka:</div>
      <div className="flex flex-col items-center" style={{ marginBottom: pt(8) }}>
        {result.rows.map((row, rowIndex) => (
          <div
            key={row.number}
            className="flex items-center"
            style={{ width: pt(gridWidth + 16), marginBottom: pt(3) }}
          >
            <span style={{ width: pt(16), fontSize: pt(9) }}>{row.number}.</span>
            <span className="flex">
              <span style={{ width: pt((offsets[rowIndex] ?? 0) * box) }} />
              {row.letters.map((letter, i) => (
                <span
                  key={i}
                  className={cn(
                    'flex items-center justify-center border border-paper-line',
                    i === row.markedIndex && 'border-2 border-paper-fg',
                  )}
                  style={{ width: pt(box), height: pt(box), fontSize: pt(box * 0.58) }}
                >
                  {solved ? letter : ''}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: pt(9), marginBottom: pt(3) }}>Otázky:</div>
      {result.rows.map((row) => (
        <div key={row.number} className="flex items-center gap-2" style={{ marginBottom: pt(3) }}>
          <span style={{ width: pt(16), fontSize: pt(9) }}>{row.number}.</span>
          {/* Pevná šířka nápovědy: jinak by se vyznačený sloupec rozpadl. */}
          <span className="truncate" style={{ width: '42%', fontSize: pt(9) }}>
            {row.clue}
          </span>
        </div>
      ))}

    </div>
  )
}
