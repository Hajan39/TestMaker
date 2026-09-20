import { Text, View } from '@react-pdf/renderer'
import type { PuzzleContent } from '../schema/puzzle'
import { buildPuzzle, describePlacement, markedOffsets, solutionGrid, type BuiltPuzzle } from '../puzzle/index'
import { sanitizeText } from './text'

/**
 * Hlavolam na papíře — mřížka osmisměrky se seznamem slov, nebo řádky
 * tajenky s políčky.
 *
 * Mřížku nikdy nesestavuje tenhle soubor: bere ji hotovou z `puzzle/`
 * (`buildPuzzle`), takže náhled na obrazovce (`PaperPuzzle` v `packages/ui`)
 * i tisk vycházejí z téhož výpočtu a nemůžou se rozejít.
 *
 * `solved` vykreslí totéž jako klíč pro učitelku: v mřížce zůstanou jen
 * písmena hledaných slov, u tajenky se políčka vyplní.
 */

/**
 * Písmeno v buňce má vždycky `lineHeight: 1`. Řádkování šablony (1,4 a víc)
 * se dědí i sem a v buňce vysoké 14 pt se řádek s ním nevejde — písmeno se
 * pak neořízne, ale úplně zmizí a mřížka se vytiskne prázdná.
 */
const CELL_BORDER = '0.5pt solid #444'
const MARKED_BORDER = '1.4pt solid #111'

/**
 * Šířka, do které se mřížka musí vejít. A4 bez okrajů má kolem 515 pt;
 * počítá se s rezervou, aby mřížka nevytlačila pravý okraj ani u šablony
 * s užšími okraji.
 */
const USABLE_WIDTH = 480

/** Velikost buňky podle počtu sloupců — úzká mřížka má buňky větší. */
export function cellSize(cols: number): number {
  return Math.max(11, Math.min(20, Math.floor(USABLE_WIDTH / Math.max(cols, 1))))
}

export function PuzzleBody({
  puzzle,
  built = buildPuzzle(puzzle),
  solved = false,
}: {
  puzzle: PuzzleContent
  /** Hotový hlavolam; když se nepředá, spočítá se z obsahu. */
  built?: BuiltPuzzle
  solved?: boolean
}) {
  if (built.kind === 'wordsearch') {
    const result = built.wordSearch
    const size = cellSize(result.cols)
    const grid = solved ? solutionGrid(result) : result.grid

    return (
      <View style={{ marginTop: 6 }}>
        <View style={{ alignSelf: 'center' }}>
          {grid.map((row, r) => (
            <View key={r} style={{ flexDirection: 'row' }}>
              {row.map((cell, c) => (
                <View
                  key={c}
                  style={{
                    width: size,
                    height: size,
                    border: CELL_BORDER,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: size * 0.58, lineHeight: 1 }}>{cell ?? ' '}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap' }}>
          {puzzle.entries.map((entry, i) => (
            <View key={i} style={{ width: '33%', paddingRight: 6, marginBottom: 2 }}>
              <Text style={{ fontSize: 9 }}>
                {sanitizeText(entry.word.toUpperCase())}
                {puzzle.kind === 'wordsearch' && puzzle.payload.showClues
                  ? ` – ${sanitizeText(entry.clue)}`
                  : ''}
              </Text>
            </View>
          ))}
        </View>

        {solved ? (
          <View style={{ marginTop: 6 }}>
            {result.placements.map((placement, i) => (
              <Text key={i} style={{ fontSize: 8, color: '#555' }}>
                {sanitizeText(describePlacement(placement))}
              </Text>
            ))}
            {result.unplaced.map((word, i) => (
              <Text key={`x-${i}`} style={{ fontSize: 8, color: '#a33' }}>
                {sanitizeText(`${word}: v mřížce není`)}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    )
  }

  const result = built.cryptogram
  const boxSize = 14
  // Odsazení řádků, aby vyznačená políčka stála pod sebou v jednom sloupci.
  const offsets = markedOffsets(result.rows)

  return (
    <View style={{ marginTop: 6 }}>
      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 9, marginBottom: 3 }}>Tajenka:</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
          {result.phraseWords.map((word, w) => (
            <View key={w} style={{ flexDirection: 'row', marginRight: 8 }}>
              {word.map((letter, i) => (
                <View
                  key={i}
                  style={{
                    width: boxSize,
                    height: boxSize,
                    border: CELL_BORDER,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: boxSize * 0.58, lineHeight: 1 }}>{solved ? letter : ' '}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </View>

      <Text style={{ fontSize: 9, marginBottom: 3 }}>Doplňovačka:</Text>
      <View style={{ alignItems: 'center', marginBottom: 8 }}>
        {result.rows.map((row, rowIndex) => (
          <View key={row.number} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
            <Text style={{ width: 16, fontSize: 9 }}>{row.number}.</Text>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ width: (offsets[rowIndex] ?? 0) * boxSize }} />
              {row.letters.map((letter, i) => (
                <View
                  key={i}
                  style={{
                    width: boxSize,
                    height: boxSize,
                    border: i === row.markedIndex ? MARKED_BORDER : CELL_BORDER,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: boxSize * 0.58, lineHeight: 1 }}>{solved ? letter : ' '}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      <Text style={{ fontSize: 9, marginBottom: 3 }}>Otázky:</Text>
      {result.rows.map((row) => (
        <View key={row.number} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
          <Text style={{ width: 16, fontSize: 9 }}>{row.number}.</Text>
          <Text style={{ width: '100%', fontSize: 9, paddingRight: 6 }}>{sanitizeText(row.clue)}</Text>
        </View>
      ))}

    </View>
  )
}
