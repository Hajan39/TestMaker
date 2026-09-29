import type { PuzzleContent } from '@testmaker/core/schema'
import { puzzleInstructions } from '@testmaker/core/schema'
import { buildPuzzle, describePlacement, solutionGrid, type BuiltPuzzle } from '@testmaker/core/puzzle'
import {
  CRYPTOGRAM_NUMBER_WIDTH,
  WORD_LIST_COLUMNS,
  cellSize,
  cryptogramLayout,
  cryptogramPhraseCells,
  placedEntries,
} from '@testmaker/core/pdf/layout'
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
 * `PaperSheet` — stejně jako u `PaperQuestion`. Velikost buněk, políček
 * a počet sloupců seznamu bere z `@testmaker/core/pdf/layout`, odkud je bere
 * i tisk.
 */

const pt = (value: number): string => `calc(${value} * var(--paper-pt, 1.3333px))`

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

      {/* Jen slova, která v mřížce opravdu jsou — a ve třech sloupcích jako na papíře. */}
      <ul
        className="grid gap-x-3"
        style={{
          fontSize: pt(9),
          marginTop: pt(8),
          gridTemplateColumns: `repeat(${WORD_LIST_COLUMNS}, minmax(0, 1fr))`,
        }}
        data-slot="puzzle-words"
      >
        {placedEntries(puzzle, built).map((entry, i) => (
          <li key={i} className="min-w-0 whitespace-normal break-words">
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
          {result.unplaced.map((word, i) => (
            <li key={`x-${i}`} className="text-danger" data-slot="puzzle-unplaced">
              {word}: v mřížce není
            </li>
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
  // Odsazení řádků (vyznačená políčka pod sebou) i velikost políčka jako na papíře.
  const { offsets, widthInBoxes, boxSize: box } = cryptogramLayout(result)
  const gridWidth = widthInBoxes * box
  const numberWidth = CRYPTOGRAM_NUMBER_WIDTH

  return (
    <div style={{ marginTop: pt(6) }} data-slot="puzzle-rows">
      <div style={{ marginBottom: pt(8) }}>
        <div style={{ fontSize: pt(9), marginBottom: pt(3) }}>Tajenka:</div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {cryptogramPhraseCells(result).map((word, w) => (
            <span key={w} className="flex">
              {word.map((cell, i) => (
                <span
                  key={i}
                  // Písmeno, na které nepřipadl žádný řádek, je předvyplněné — jako v PDF.
                  className={cn(
                    'flex items-center justify-center border border-paper-line',
                    !cell.row && 'bg-paper-shade',
                  )}
                  style={{ width: pt(box), height: pt(box), fontSize: pt(box * 0.58) }}
                >
                  {solved || !cell.row ? cell.letter : ''}
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
            data-slot="puzzle-row"
            className="flex items-center"
            style={{ width: pt(gridWidth + numberWidth), marginBottom: pt(3) }}
          >
            <span
              className="shrink-0 text-right leading-none"
              style={{ width: pt(numberWidth), paddingRight: pt(4), fontSize: pt(9) }}
            >
              {row.number}.
            </span>
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
        <div key={row.number} className="flex items-start gap-2" style={{ marginBottom: pt(3) }}>
          <span className="shrink-0" style={{ width: pt(numberWidth), fontSize: pt(9) }}>
            {row.number}.
          </span>
          <span className="min-w-0 flex-1 whitespace-normal break-words" style={{ fontSize: pt(9) }}>
            {row.clue}
          </span>
        </div>
      ))}

    </div>
  )
}
