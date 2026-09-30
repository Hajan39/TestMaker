/**
 * Pomocníci vykreslení, které používá PDF i papírová stránka ve skladači
 * testu. Jsou tu proto, aby obrazovka a papír nemohly říkat každý něco
 * jiného: číslování mezer v doplňovačce, značky prázdných buněk v tabulce
 * i zápis bodů má jedinou definici.
 *
 * Tenhle soubor nesmí sáhnout na `@react-pdf/renderer` — vtahuje se do
 * prohlížeče, kam vykreslovač PDF nepatří.
 */

import type { PuzzleContent, PuzzleEntry } from '../schema/puzzle'
import { buildPuzzle, markedOffsets, puzzleProblems, type BuiltPuzzle, type CryptogramResult } from '../puzzle/index'

export { LETTERS, questionLabel } from './styles'
export { displayOrder } from './shuffle'
export { formatAnswer } from './answerKey'

/** Body s desetinnou čárkou podle českého úzu, celá čísla bez zbytečné nuly. */
export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1).replace('.', ',')
}

/**
 * Rozměry položek pracovního listu v bodech. Čte je vykreslení PDF
 * (`WorksheetBlocks.tsx`) i odhad výšky (`estimate.ts`), aby se náhled
 * lámal tam, kde PDF.
 */
export const WORKSHEET_LAYOUT = {
  /** Mezera nad krátkým textem. */
  textSpacing: 8,
  /** Mezera nad rámečkem fun factu a nad tabulkou. */
  blockSpacing: 10,
  /** Vnitřní okraj rámečku fun factu. */
  funFactPadding: 6,
  /** Vnitřní okraj buňky tabulky. */
  cellPadding: 4,
  /** Nejmenší výška řádku tabulky — do prázdné buňky se píše rukou. */
  rowMinHeight: 22,
} as const

/**
 * Zadání doplňovačky, ve kterém jsou místa k doplnění (`___`) nahrazená
 * očíslovanou linkou. Týmiž čísly se na mezery odkazuje klíč, takže se
 * odpovědi nemusí dopočítávat podle pořadí v textu.
 */
export function numberedBlanks(text: string): string {
  let blankNumber = 0
  return (
    text
      .replace(/___/g, () => {
        blankNumber += 1
        return ` (${blankNumber}) ______________ `
      })
      // Mezery kolem značky drží čitelnost i tam, kde je „___“ přilepené ke
      // slovu; tady se jen uklidí, co tím vzniklo navíc.
      .replace(/ {2,}/g, ' ')
      .replace(/ ([,.;:!?])/g, '$1')
      .trim()
  )
}

/**
 * Čísla prázdných buněk doplňovací tabulky v pořadí čtení po řádcích;
 * vyplněná buňka má `null`. Čísla odpovídají pořadí odpovědí v klíči.
 */
export function tableBlankNumbers(rows: (string | null)[][]): (number | null)[][] {
  let blankNumber = 0
  return rows.map((row) => row.map((cell) => (cell ? null : (blankNumber += 1))))
}

/* ------------------------------------------------------------------------
 * Rozměry hlavolamu. Tiskne je `PuzzleBody` (PDF), náhled `PaperPuzzle`
 * i odhad výšky v `estimate.ts` — jedna definice, aby se obrazovka, papír
 * a stránkování nerozešly.
 * --------------------------------------------------------------------- */

/**
 * Šířka, do které se mřížka i řádky tajenky musí vejít. A4 bez okrajů má
 * u vestavěných šablon 493–521 pt; počítá se s rezervou, aby hlavolam
 * nevytlačil pravý okraj ani u šablony s užšími okraji.
 */
export const PUZZLE_USABLE_WIDTH = 480

/** Velikost buňky osmisměrky podle počtu sloupců — úzká mřížka má buňky větší. */
export function cellSize(cols: number): number {
  return Math.max(11, Math.min(20, Math.floor(PUZZLE_USABLE_WIDTH / Math.max(cols, 1))))
}

/** Počet sloupců seznamu slov pod osmisměrkou — na papíře i na obrazovce. */
export const WORD_LIST_COLUMNS = 3

/** Šířka sloupce s číslem řádku tajenky („10.“ se nesmí dotýkat políčka). */
export const CRYPTOGRAM_NUMBER_WIDTH = 20

/** Políčko tajenky — pro děti aspoň 18 pt, ideálně 20 pt (asi 7 mm). */
export const CRYPTOGRAM_BOX_MAX = 20
/** Pod tohle se políčko nezmenší ani u nejdelšího slova. */
export const CRYPTOGRAM_BOX_MIN = 12

/**
 * Velikost políčka tajenky. Nejširší řádek (i s odsazením, které staví
 * vyznačená políčka pod sebe) se musí vejít do šířky stránky; jen když se
 * nevejde, políčka se zmenší.
 */
export function cryptogramBoxSize(widthInBoxes: number): number {
  const fit = Math.floor((PUZZLE_USABLE_WIDTH - CRYPTOGRAM_NUMBER_WIDTH) / Math.max(widthInBoxes, 1))
  return Math.max(CRYPTOGRAM_BOX_MIN, Math.min(CRYPTOGRAM_BOX_MAX, fit))
}

/** Rozvržení řádků tajenky: odsazení každého řádku a velikost políčka. */
export function cryptogramLayout(result: CryptogramResult): {
  offsets: number[]
  widthInBoxes: number
  boxSize: number
} {
  // Odsazení řádků, aby vyznačená políčka stála pod sebou v jednom sloupci.
  const offsets = markedOffsets(result.rows)
  const widthInBoxes = Math.max(...result.rows.map((row, i) => (offsets[i] ?? 0) + row.letters.length), 1)
  return { offsets, widthInBoxes, boxSize: cryptogramBoxSize(widthInBoxes) }
}

/**
 * Písmena tajenky po slovech s číslem řádku, který k písmenu patří. Když se
 * na písmeno nenašlo slovo, `row` chybí a políčko se vytiskne rovnou
 * vyplněné — žák by jinak hledal řádek, který na papíře není.
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
 * Slova do seznamu pod osmisměrkou — jen ta, která v mřížce opravdu jsou.
 * Slovo, které se do mřížky nevešlo, by žák hledal marně.
 */
export function placedEntries(puzzle: PuzzleContent, built: BuiltPuzzle): PuzzleEntry[] {
  if (built.kind !== 'wordsearch') return puzzle.entries
  const placed = new Set(built.wordSearch.placements.map((placement) => placement.word))
  return puzzle.entries.filter((entry) => placed.has(entry.word))
}

/**
 * Hlavolam pro danou variantu písemky. Varianta B dostane jiný (pořád
 * deterministický) seed, aby osmisměrka nebo tajenka nevyšla stejně jako
 * u souseda v lavici. Když by jiný seed dopadl hůř (méně umístěných slov,
 * víc potíží), zůstane zadání varianty A — horší hlavolam za cenu jiného
 * vzhledu nestojí.
 */
export function puzzleForVariant(puzzle: PuzzleContent, variant: 'A' | 'B'): PuzzleContent {
  if (variant === 'A') return puzzle
  const other = { ...puzzle, payload: { ...puzzle.payload, seed: `${puzzle.payload.seed}:B` } } as PuzzleContent
  const worse = puzzleProblems(buildPuzzle(other)).length > puzzleProblems(buildPuzzle(puzzle)).length
  return worse ? puzzle : other
}
