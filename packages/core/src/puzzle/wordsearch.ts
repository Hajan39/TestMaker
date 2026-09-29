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
 * Česká abeceda s vahami podle toho, jak často se písmeno v češtině
 * objevuje (zhruba v procentech; vzácná písmena zvednutá na 1). Bere se do výplně, když
 * slova sama dávají příliš málo písmen. Vzácná písmena (Ď, Ť, Ň, Ů, Ó)
 * v ní jsou schválně také — jinak by slovo s háčkem v mřížce svítilo
 * jako jediné písmeno svého druhu a žák by ho našel bez hledání.
 */
const CZECH_LETTER_WEIGHTS: Readonly<Record<string, number>> = {
  O: 9, E: 8, A: 7, N: 7, T: 6, S: 5, I: 5, V: 4, L: 4, R: 4, K: 4, D: 4,
  P: 3, M: 3, U: 3, Í: 3, Á: 2, Z: 2, J: 2, Y: 2, B: 2, C: 2, Ě: 2,
  H: 1, Ř: 1, Č: 1, Ž: 1, Š: 1, Ý: 1, É: 1, Ů: 1, Ú: 1, Ť: 1, Ď: 1, Ň: 1, Ó: 1, F: 1, G: 1,
}

/**
 * Písmena do výplně, když slova sama nestačí. Každé písmeno je tu tolikrát,
 * kolik je jeho váha — rovnoměrný los z pole je tak los vážený.
 */
const FILLER_FALLBACK: readonly string[] = Object.entries(CZECH_LETTER_WEIGHTS).flatMap(([letter, weight]) =>
  Array.from({ length: weight }, () => letter),
)

/**
 * Sprostá slova, která výplň nesmí náhodou složit v žádném směru. Porovnává
 * se bez háčků a čárek (i „PICA" dítě přečte), proto jsou tu jen základní
 * tvary. Seznam je schválně krátký: jde o to, aby osmisměrka neodešla do
 * třídy s nadávkou, ne o úplný slovník.
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
 * Kolikrát se celá mřížka zkusí poskládat znovu, když se z písmen slov
 * (ne z výplně) složí slovo ze seznamu podruhé nebo sprosté slovo. Taková
 * shoda se přelosováním výplně opravit nedá.
 */
const LAYOUT_ATTEMPTS = 8

/** Kolik kol přelosování výplně se zkusí, než se to vzdá. */
const REROLL_ROUNDS = 200

/** Písmena bez háčků a čárek. */
function baseLetter(letter: string): string {
  return letter.normalize('NFD').replace(/\p{M}/gu, '')
}

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

/** Výskyt hledaného řetězce v mřížce: index cíle a buňky (řádek × šířka + sloupec). */
interface Occurrence {
  target: number
  cells: number[]
}

/**
 * Všechny výskyty cílů v mřížce ve všech osmi směrech — tak, jak je hledá
 * žák, bez ohledu na to, v jakých směrech se slova pokládala.
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

/** Jedno poskládání mřížky: slova, výplň a to, co se opravit nepodařilo. */
interface Layout {
  grid: string[][]
  placements: WordSearchPlacement[]
  unplaced: string[]
  problems: PuzzleProblem[]
  /** Slova ze seznamu, která v mřížce leží víckrát (a opravit to nešlo). */
  repeated: Set<string>
  /** Sprostá slova, která v mřížce zůstala. */
  vulgar: Set<string>
}

/** Sestaví osmisměrku. Nic nevyhazuje — potíže vrací v `problems`. */
export function buildWordSearch(input: WordSearchInput): WordSearchResult {
  const { cols, rows, seed } = input
  const directions = input.directions && input.directions.length > 0 ? input.directions : WORD_SEARCH_DIRECTIONS

  const problems: PuzzleProblem[] = []
  const unplaced: string[] = []

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

  // Slovo schované v jiném slově ze seznamu (i pozpátku) najde žák v mřížce
  // víckrát, ať se položí kamkoli — to se opravit nedá, jen říct učitelce.
  candidates.forEach((short, i) => {
    const word = short.letters.join('')
    for (const [j, long] of candidates.entries()) {
      if (i === j || long.letters.length < short.letters.length) continue
      const forward = long.letters.join('')
      const backward = [...long.letters].reverse().join('')
      const sameLength = long.letters.length === short.letters.length
      // Stejně dlouhá dvojice (ret × ter) se ohlásí jen jednou, u pozdějšího slova.
      if (sameLength && j > i) continue
      if (sameLength ? backward === word : forward.includes(word) || backward.includes(word)) {
        problems.push({
          subject: short.entry.word,
          message: sameLength
            ? `Slovo „${short.entry.word}" je pozpátku slovo „${long.entry.word}" — žák ho v mřížce najde dvakrát. Jedno z nich vynech.`
            : `Slovo „${short.entry.word}" je schované ve slově „${long.entry.word}" — žák ho v mřížce najde víckrát. Nahraď ho jiným slovem, nebo ho vynech.`,
        })
        break
      }
    }
  })

  // Nejdelší slova první: na ta je v mřížce nejmíň místa, a když se položí
  // až nakonec, často se už nevejdou. Stejně dlouhá slova jdou v pořadí
  // zadání (řazení je stabilní) — proto **jiné pořadí slov dá jinou mřížku**,
  // i když seed zůstane stejný. Je to v pořádku: táž slova v témž pořadí
  // a týž seed dají vždycky tutéž mřížku, a na tom tisk po měsíci stojí.
  const ordered = [...candidates].sort((a, b) => b.letters.length - a.letters.length)

  const blocklist = WORD_SEARCH_BLOCKLIST.map((word) => [...word].map(baseLetter))

  /** Poskládá mřížku jednou; `attempt` > 0 je nový pokus s jiným losem. */
  function layout(attempt: number): Layout {
    // První pokus má los jako vždycky, aby dřívější mřížky zůstaly, jaké byly.
    const base = `osmismerka:${seed}:${cols}x${rows}`
    const rand = seededRandom(hashSeed(attempt === 0 ? base : `${base}:${attempt}`))
    const layoutProblems: PuzzleProblem[] = []
    const layoutUnplaced: string[] = []
    const grid: (string | null)[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null))

    const placements: WordSearchPlacement[] = []
    for (const { entry, letters } of ordered) {
      // Všechna možná místa, zamíchaná seedem. Prochází se celý seznam, takže
      // se slovo neumístí náhodně „skoro vždycky", ale vždycky, když místo je.
      // Místo, kde by slovo leželo celé na písmenech jiných slov, se nepočítá:
      // „les" uvnitř „lesníku" by žák nenašel jako samostatné slovo a klíč
      // by ukazoval dvě slova na týchž buňkách.
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
          message: `Slovo „${entry.word}" se do mřížky nevešlo. Zvětši mřížku, uber slova, nebo zkus jiný seed.`,
        })
        continue
      }

      // Z náhodného pořadí se vybere místo s největším překryvem — slova se tak
      // proplétají a mřížka nevypadá jako seznam vedle sebe.
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

    // Výplň: písmena z použitých slov, ať mřížka vypadá česky.
    const pool = placements.flatMap((placement) => placement.letters)
    const filler = pool.length >= 8 ? [...new Set(pool)] : FILLER_FALLBACK
    const pick = () => filler[Math.floor(rand() * filler.length)] as string
    const filled = grid.map((row) => row.map((cell) => cell ?? pick()))

    // Buňky slov jsou pevné; přelosovat se smí jen výplň.
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
     * Výskyty, které v mřížce nemají co dělat: slovo ze seznamu jinde než na
     * svém místě, nebo sprosté slovo. Výskyt uvnitř jediného slova ze seznamu
     * se nepočítá — „les" v „lesníku" je ohlášený výš a sprosté slovo, které
     * je součástí zadaného slova, si učitelka napsala sama.
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

    // Přelosování výplně: v každém nežádoucím výskytu se vymění jedna buňka
    // výplně. Los jde z téhož generátoru, takže výsledek zůstává určený seedem.
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

  // Když se nežádoucí shoda složí přímo z písmen slov, výplň nepomůže —
  // mřížka se poskládá znovu s jiným losem. Vybere se první čistá, jinak
  // ta, ve které se vešlo nejvíc slov a zůstalo nejmíň potíží.
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
      message: `Slovo „${word}" se v mřížce složilo víckrát z písmen jiných slov. Zkus jiný seed, nebo slovo nahraď.`,
    })
  }
  for (const word of chosen.vulgar) {
    problems.push({
      message: `Z písmen slov se v mřížce složilo nevhodné slovo („${word}"). Zkus jiný seed.`,
    })
  }

  // Pořadí v `placements` je podle délky slov; učitelka i klíč čtou seznam
  // tak, jak ho napsala, proto se vrací v pořadí zadání.
  const placements = chosen.placements
  const orderOf = new Map(input.entries.map((entry, index) => [entry.word, index]))
  placements.sort((a, b) => (orderOf.get(a.word) ?? 0) - (orderOf.get(b.word) ?? 0))

  return { cols, rows, grid: chosen.grid, placements, unplaced, problems }
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
