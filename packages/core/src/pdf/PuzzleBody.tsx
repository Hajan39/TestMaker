import type { ReactNode } from 'react'
import { Text, View } from '@react-pdf/renderer'
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
 * Hlavolam na papíře — mřížka osmisměrky se seznamem slov, nebo řádky
 * tajenky s políčky.
 *
 * Mřížku nikdy nesestavuje tenhle soubor: bere ji hotovou z `puzzle/`
 * (`buildPuzzle`), takže náhled na obrazovce (`PaperPuzzle` v `packages/ui`)
 * i tisk vycházejí z téhož výpočtu a nemůžou se rozejít. Rozměry (buňky,
 * políčka, sloupce) jsou v `layout.ts`, odkud je bere i odhad výšky.
 *
 * `solved` vykreslí totéž jako klíč pro učitelku: v mřížce zůstanou jen
 * písmena hledaných slov, u tajenky se políčka vyplní.
 *
 * Zalamování přes stránky: nerozdělitelná je jen hlavička (`head` — nadpis
 * a pokyn) spolu s mřížkou, resp. s políčky tajenky. Seznam slov, řádky
 * doplňovačky a otázky se smí přelomit na další stranu, vždy ale po celých
 * řádcích. Kdyby byl nerozdělitelný celý hlavolam a byl vyšší než strana,
 * react-pdf ho nepřesune, ale slisuje — překrývající se text a slitá mřížka.
 */

/**
 * Písmeno v buňce má vždycky `lineHeight: 1`. Řádkování šablony (1,4 a víc)
 * se dědí i sem a v buňce vysoké 14 pt se řádek s ním nevejde — písmeno se
 * pak neořízne, ale úplně zmizí a mřížka se vytiskne prázdná.
 */
const CELL_BORDER = '0.5pt solid #444'
const MARKED_BORDER = '1.4pt solid #111'
/** Políčko tajenky, na které žádný řádek nepřipadl — vytiskne se vyplněné. */
const GIVEN_BACKGROUND = '#f0f0f0'

/** Velikost písma popisků a seznamů pod hlavolamem. */
export const PUZZLE_TEXT_SIZE = 9

export function PuzzleBody({
  puzzle,
  built = buildPuzzle(puzzle),
  solved = false,
  head,
  spacingBefore = 0,
}: {
  puzzle: PuzzleContent
  /** Hotový hlavolam; když se nepředá, spočítá se z obsahu. */
  built?: BuiltPuzzle
  solved?: boolean
  /** Nadpis a pokyn; tisknou se nerozdělitelně spolu s mřížkou. */
  head?: ReactNode
  /** Mezera nad hlavolamem. */
  spacingBefore?: number
}) {
  // Vrací se plochý seznam bloků, ne jeden obalový `View`. React-pdf přesune
  // nerozdělitelný blok na další stranu jen tehdy, když má před sebou
  // sourozence; zanořený jako první potomek obalu by ho místo toho rozřízl
  // a slisoval. Bloky proto musí být přímými potomky stránky.
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
                  {sanitizeText(`${word}: v mřížce není`)}
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
          <Text style={{ fontSize: PUZZLE_TEXT_SIZE, marginBottom: 3 }}>Tajenka:</Text>
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
        Doplňovačka:
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
        Otázky:
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

/** Seznam slov po řádcích o třech sloupcích; každý řádek je nerozdělitelný. */
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
