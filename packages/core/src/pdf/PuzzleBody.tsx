import type { ReactNode } from 'react'
import { Text, View } from '@react-pdf/renderer'
import { t } from '../i18n'
import type { PuzzleContent, PuzzleEntry } from '../schema/puzzle'
import { buildPuzzle, describePlacement, solutionGrid, type BuiltPuzzle } from '../puzzle/index'
import {
  CRYPTOGRAM_NUMBER_WIDTH,
  WORD_LIST_COLUMNS,
  cellSize,
  cryptogramLayout,
  cryptogramPhraseCells,
  placedEntries,
} from './layout'
import { sanitizeText } from './text'

export { cellSize } from './layout'

/**
 * A puzzle on paper — a word search grid with the word list, or cryptogram
 * rows with boxes.
 *
 * This file never builds the grid: it takes it ready-made from `puzzle/`
 * (`buildPuzzle`), so the on-screen preview (`PaperPuzzle` in `packages/ui`)
 * and the print come from the same computation and cannot diverge. Dimensions
 * (cells, boxes, columns) are in `layout.ts`, where the height estimate reads
 * them too.
 *
 * `solved` renders the same as the teacher's key: only the letters of the
 * hidden words stay in the grid; cryptogram boxes are filled in.
 *
 * Page breaking: only the head (`head` — title and instructions) together
 * with the grid (or the cryptogram boxes) is unbreakable. The word list, the
 * crossword rows and the clues may break onto the next page, but always by
 * whole rows. If the whole puzzle were unbreakable and taller than a page,
 * react-pdf would not move it but squash it — overlapping text and a mashed grid.
 */

/**
 * A letter in a cell always has `lineHeight: 1`. The template line height
 * (1.4 and more) is inherited here too and a line with it does not fit a
 * 14 pt cell — the letter is not clipped but vanishes and the grid prints empty.
 */
const CELL_BORDER = '0.5pt solid #444'
const MARKED_BORDER = '1.4pt solid #111'
/** Cryptogram box with no row assigned — printed pre-filled. */
const GIVEN_BACKGROUND = '#f0f0f0'

/** Font size of labels and lists below the puzzle. */
export const PUZZLE_TEXT_SIZE = 9

export function PuzzleBody({
  puzzle,
  built = buildPuzzle(puzzle),
  solved = false,
  head,
  spacingBefore = 0,
}: {
  puzzle: PuzzleContent
  /** Prebuilt puzzle; computed from the content when not passed. */
  built?: BuiltPuzzle
  solved?: boolean
  /** Title and instructions; printed unbreakably together with the grid. */
  head?: ReactNode
  /** Space above the puzzle. */
  spacingBefore?: number
}) {
  // Returns a flat list of blocks, not one wrapping `View`. React-pdf moves an
  // unbreakable block to the next page only when it has a preceding sibling;
  // nested as the first child of a wrapper it would cut and squash it instead.
  // The blocks must therefore be direct children of the page.
  if (built.kind === 'wordsearch') {
    const result = built.wordSearch
    const size = cellSize(result.cols)
    const grid = solved ? solutionGrid(result) : result.grid
    const showClues = puzzle.kind === 'wordsearch' && puzzle.payload.showClues

    return (
      <>
        <View wrap={false} style={{ marginTop: spacingBefore }}>
          {head}
          <View style={{ marginTop: 6, alignSelf: 'center' }}>
            {grid.map((row, r) => (
              <View key={r} style={{ flexDirection: 'row' }}>
                {row.map((cell, c) => (
                  <Box key={c} size={size} letter={cell ?? ' '} />
                ))}
              </View>
            ))}
          </View>
        </View>

        {wordListRows(placedEntries(puzzle, built)).map((row, r) => (
          <View key={`w-${r}`} wrap={false} style={{ flexDirection: 'row', marginTop: r === 0 ? 8 : 0, marginBottom: 2 }}>
            {row.map((entry, i) => (
              <View key={i} style={{ width: `${100 / WORD_LIST_COLUMNS}%`, paddingRight: 6 }}>
                <Text style={{ fontSize: PUZZLE_TEXT_SIZE }}>
                  {sanitizeText(entry.word.toUpperCase())}
                  {showClues ? ` – ${sanitizeText(entry.clue)}` : ''}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {solved
          ? [
              ...result.placements.map((placement, i) => (
                <Text key={`p-${i}`} style={{ fontSize: 8, color: '#555', marginTop: i === 0 ? 6 : 0 }}>
                  {sanitizeText(describePlacement(placement))}
                </Text>
              )),
              ...result.unplaced.map((word, i) => (
                <Text key={`x-${i}`} style={{ fontSize: 8, color: '#a33' }}>
                  {sanitizeText(t('pdf:puzzle.notInGrid', { word }))}
                </Text>
              )),
            ]
          : null}
      </>
    )
  }

  const result = built.cryptogram
  const { offsets, widthInBoxes, boxSize } = cryptogramLayout(result)
  const rowWidth = widthInBoxes * boxSize + CRYPTOGRAM_NUMBER_WIDTH

  return (
    <>
      <View wrap={false} style={{ marginTop: spacingBefore }}>
        {head}
        <View style={{ marginTop: 6, marginBottom: 8 }}>
          <Text style={{ fontSize: PUZZLE_TEXT_SIZE, marginBottom: 3 }}>{t('pdf:puzzle.phrase')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
            {cryptogramPhraseCells(result).map((word, w) => (
              <View key={w} style={{ flexDirection: 'row', marginRight: 8, marginBottom: 2 }}>
                {word.map((cell, i) => (
                  <Box
                    key={i}
                    size={boxSize}
                    letter={solved || !cell.row ? cell.letter : ' '}
                    background={cell.row ? undefined : GIVEN_BACKGROUND}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      </View>

      <Text style={{ fontSize: PUZZLE_TEXT_SIZE, marginBottom: 3 }} minPresenceAhead={boxSize + 3}>
        {t('pdf:puzzle.crossword')}
      </Text>
      {result.rows.map((row, rowIndex) => (
        <View
          key={`r-${row.number}`}
          wrap={false}
          style={{
            width: rowWidth,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: rowIndex === result.rows.length - 1 ? 11 : 3,
          }}
        >
          <Text
            style={{
              width: CRYPTOGRAM_NUMBER_WIDTH,
              paddingRight: 4,
              textAlign: 'right',
              fontSize: PUZZLE_TEXT_SIZE,
              lineHeight: 1,
            }}
          >
            {row.number}.
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: (offsets[rowIndex] ?? 0) * boxSize }} />
            {row.letters.map((letter, i) => (
              <Box
                key={i}
                size={boxSize}
                letter={solved ? letter : ' '}
                border={i === row.markedIndex ? MARKED_BORDER : CELL_BORDER}
              />
            ))}
          </View>
        </View>
      ))}

      <Text style={{ fontSize: PUZZLE_TEXT_SIZE, marginBottom: 3 }} minPresenceAhead={14}>
        {t('pdf:puzzle.clues')}
      </Text>
      {result.rows.map((row) => (
        <View
          key={`q-${row.number}`}
          wrap={false}
          style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 }}
        >
          <Text style={{ width: CRYPTOGRAM_NUMBER_WIDTH, fontSize: PUZZLE_TEXT_SIZE }}>{row.number}.</Text>
          <Text style={{ flex: 1, fontSize: PUZZLE_TEXT_SIZE, paddingRight: 6 }}>{sanitizeText(row.clue)}</Text>
        </View>
      ))}
    </>
  )
}

/** Word list in rows of three columns; each row is unbreakable. */
function wordListRows(entries: PuzzleEntry[]): PuzzleEntry[][] {
  const rows: PuzzleEntry[][] = []
  for (let i = 0; i < entries.length; i += WORD_LIST_COLUMNS) rows.push(entries.slice(i, i + WORD_LIST_COLUMNS))
  return rows
}

function Box({
  size,
  letter,
  border = CELL_BORDER,
  background,
}: {
  size: number
  letter: string
  border?: string
  background?: string
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        border,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.58, lineHeight: 1 }}>{letter}</Text>
    </View>
  )
}
