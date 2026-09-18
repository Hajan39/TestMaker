import type { PuzzleEntry } from '../schema/puzzle'
import { hashSeed, seededRandom, shuffled } from '../pdf/shuffle'
import { puzzleLetters, splitWord, type PuzzleProblem } from './letters'

/**
 * Osmisměrka: slova se rozmístí do mřížky v osmi směrech, zbytek se dosype
 * náhodnými písmeny.
 *
 * Losování je řízené seedem (`seededRandom` z `pdf/shuffle`, týž generátor
 * jako u variant testu), takže táž slova a týž seed dají vždycky tutéž
 * mřížku — vytištěná osmisměrka jde po měsíci vyrobit znovu beze změny.
 *
 * Co se nevejde nebo nejde umístit, se **nikdy tiše nevynechá**: takové slovo
 * skončí v `problems` i v `unplaced` a volající to učitelce řekne, než se
 * hlavolam vytiskne. Žák by jinak hledal slovo, které v mřížce není.
 */

export interface WordSearchDirection {
  /** Posun po řádcích (−1 nahoru, 0 vodorovně, 1 dolů). */
  dr: -1 | 0 | 1
  /** Posun po sloupcích. */
  dc: -1 | 0 | 1
  /** Jméno směru do klíče pro učitelku. */
  label: string
}

/** Osm směrů, ve kterých smí slovo ležet. */
export const WORD_SEARCH_DIRECTIONS: readonly WordSearchDirection[] = [
  { dr: 0, dc: 1, label: 'vpravo' },
  { dr: 0, dc: -1, label: 'vlevo' },
  { dr: 1, dc: 0, label: 'dolů' },
  { dr: -1, dc: 0, label: 'nahoru' },
  { dr: 1, dc: 1, label: 'vpravo dolů' },
  { dr: 1, dc: -1, label: 'vlevo dolů' },
  { dr: -1, dc: 1, label: 'vpravo nahoru' },
  { dr: -1, dc: -1, label: 'vlevo nahoru' },
]

export interface WordSearchPlacement {
  /** Slovo tak, jak ho napsala učitelka. */
  word: string
  /** Písmena v buňkách (velká, bez mezer). */
  letters: string[]
  row: number
  col: number
  direction: WordSearchDirection
}

export interface WordSearchResult {
  cols: number
  rows: number
  /** Mřížka po řádcích; každá buňka je jedno velké písmeno. */
  grid: string[][]
  placements: WordSearchPlacement[]
  /** Slova, na která se v mřížce nenašlo místo. */
  unplaced: string[]
  problems: PuzzleProblem[]
}

export interface WordSearchInput {
  entries: PuzzleEntry[]
  cols: number
  rows: number
  seed: string
  /**
   * Povolené směry; prázdné (nebo chybí) = všech osm. Slouží testům
   * a případnému snazšímu zadání pro mladší žáky.
   */
  directions?: readonly WordSearchDirection[]
}

/** Nejkratší slovo, které má v osmisměrce smysl hledat. */
const MIN_WORD_LETTERS = 2

/**
 * Písmena do výplně. Berou se z použitých slov, aby mřížka vypadala česky
 * (včetně háčků) a výplň slova neprozrazovala cizími znaky. Když by pool byl
 * příliš chudý, doplní se o běžná česká písmena.
 */
const FILLER_FALLBACK = 'AÁBCČDEÉĚFGHIÍJKLMNŇOÓPRŘSŠTŤUÚVYÝZŽ'.split('')

/** Vejde se slovo na dané místo? Překryv se povolí jen na shodném písmenu. */
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

/** Kolik písmen se při tomhle umístění překryje s už položenými slovy. */
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

/** Sestaví osmisměrku. Nic nevyhazuje — potíže vrací v `problems`. */
export function buildWordSearch(input: WordSearchInput): WordSearchResult {
  const { cols, rows, seed } = input
  const directions = input.directions && input.directions.length > 0 ? input.directions : WORD_SEARCH_DIRECTIONS
  const rand = seededRandom(hashSeed(`osmismerka:${seed}:${cols}x${rows}`))

  const problems: PuzzleProblem[] = []
  const unplaced: string[] = []
  const grid: (string | null)[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null))

  /** Nejdelší úsečka, která se do mřížky vejde — víc písmen se tam nevejde nikdy. */
  const longestPossible = Math.max(cols, rows)

  const candidates: { entry: PuzzleEntry; letters: string[] }[] = []
  const seen = new Set<string>()
  for (const entry of input.entries) {
    const { letters, unusable } = splitWord(entry.word)
    if (unusable.length > 0) {
      problems.push({
        subject: entry.word,
        message: `Slovo „${entry.word}" obsahuje znaky, které se do mřížky zapsat nedají (${unusable.join(' ')}). Nech v něm jen písmena.`,
      })
    }
    if (letters.length < MIN_WORD_LETTERS) {
      problems.push({
        subject: entry.word,
        message: `Slovo „${entry.word}" je na osmisměrku příliš krátké — potřebuje aspoň dvě písmena.`,
      })
      unplaced.push(entry.word)
      continue
    }
    if (letters.length > longestPossible) {
      problems.push({
        subject: entry.word,
        message: `Slovo „${entry.word}" má ${letters.length} písmen a do mřížky ${cols} × ${rows} se nevejde. Zvětši mřížku, nebo slovo vynech.`,
      })
      unplaced.push(entry.word)
      continue
    }
    const key = letters.join('')
    if (seen.has(key)) {
      problems.push({
        subject: entry.word,
        message: `Slovo „${entry.word}" je v seznamu podruhé; v mřížce bude jen jednou.`,
      })
      continue
    }
    seen.add(key)
    candidates.push({ entry, letters })
  }

  // Nejdelší slova první: na ta je v mřížce nejmíň místa, a když se položí
  // až nakonec, často se už nevejdou.
  const ordered = [...candidates].sort((a, b) => b.letters.length - a.letters.length)

  const placements: WordSearchPlacement[] = []
  for (const { entry, letters } of ordered) {
    // Všechna možná místa, zamíchaná seedem. Prochází se celý seznam, takže
    // se slovo neumístí náhodně „skoro vždycky", ale vždycky, když místo je.
    const spots: { row: number; col: number; direction: WordSearchDirection }[] = []
    for (const direction of directions) {
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          if (fits(grid, letters, row, col, direction)) spots.push({ row, col, direction })
        }
      }
    }

    if (spots.length === 0) {
      unplaced.push(entry.word)
      problems.push({
        subject: entry.word,
        message: `Slovo „${entry.word}" se do mřížky nevešlo. Zvětši mřížku, uber slova, nebo zkus jiný seed.`,
      })
      continue
    }

    // Z náhodného pořadí se vybere místo s největším překryvem — slova se tak
    // proplétají a mřížka nevypadá jako seznam vedle sebe.
    const shuffledSpots = shuffled(spots, rand)
    let best = shuffledSpots[0] as { row: number; col: number; direction: WordSearchDirection }
    let bestOverlap = -1
    for (const spot of shuffledSpots) {
      const overlap = overlapCount(grid, letters, spot.row, spot.col, spot.direction)
      if (overlap > bestOverlap) {
        best = spot
        bestOverlap = overlap
      }
    }

    for (let i = 0; i < letters.length; i += 1) {
      const r = best.row + best.direction.dr * i
      const c = best.col + best.direction.dc * i
      ;(grid[r] as (string | null)[])[c] = letters[i] as string
    }
    placements.push({ word: entry.word, letters, row: best.row, col: best.col, direction: best.direction })
  }

  // Výplň: písmena z použitých slov, ať mřížka vypadá česky.
  const pool = placements.flatMap((placement) => placement.letters)
  const filler = pool.length >= 8 ? [...new Set(pool)] : FILLER_FALLBACK
  const filled = grid.map((row) =>
    row.map((cell) => cell ?? (filler[Math.floor(rand() * filler.length)] as string)),
  )

  // Pořadí v `placements` je podle délky slov; učitelka i klíč čtou seznam
  // tak, jak ho napsala, proto se vrací v pořadí zadání.
  const orderOf = new Map(input.entries.map((entry, index) => [entry.word, index]))
  placements.sort((a, b) => (orderOf.get(a.word) ?? 0) - (orderOf.get(b.word) ?? 0))

  return { cols, rows, grid: filled, placements, unplaced, problems }
}

/**
 * Najde slovo v hotové mřížce — všech osm směrů. Vrací všechna místa, kde
 * slovo leží. Slouží kontrole (a testům): co se vytiskne, musí jít najít.
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
 * Mřížka, ve které jsou vidět jen písmena hledaných slov — klíč pro
 * učitelku. Ostatní buňky jsou prázdné, takže je řešení na první pohled.
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

/** Popis, kde slovo leží — jedna řádka klíče („STONEK: řádek 3, sloupec 5, vpravo dolů"). */
export function describePlacement(placement: WordSearchPlacement): string {
  return `${placement.word}: řádek ${placement.row + 1}, sloupec ${placement.col + 1}, ${placement.direction.label}`
}
