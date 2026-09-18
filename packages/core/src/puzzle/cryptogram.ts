import type { PuzzleEntry } from '../schema/puzzle'
import { hashSeed, seededRandom, shuffled } from '../pdf/shuffle'
import { phraseWords, splitWord, type PuzzleProblem } from './letters'

/**
 * Tajenka: žák doplní slova podle nápověd a z písmen ve vyznačených
 * políčkách přečte tajenou větu.
 *
 * Řádek tajenky odpovídá jednomu písmenu věty — kolik má věta písmen, tolik
 * je řádků a tolik je potřeba slov. Na které písmeno ve slově políčko
 * připadne, rozhoduje los řízený seedem, takže se tentýž hlavolam dá
 * vytisknout znovu stejně.
 *
 * Co se nepovede (na některé písmeno se nenajde slovo, slov je málo), se
 * hlásí v `problems` — tichá tajenka, ze které vyjde jiná věta, by se na
 * papíře poznala až u dětí.
 */

export interface CryptogramRow {
  /** Pořadí řádku = pořadí písmene v tajence (od jedné). */
  number: number
  clue: string
  /** Slovo tak, jak ho napsala učitelka. */
  word: string
  /** Písmena slova po buňkách. */
  letters: string[]
  /** Které políčko řádku patří do tajenky (index do `letters`). */
  markedIndex: number
  /** Písmeno tajenky v tomhle řádku. */
  letter: string
}

export interface CryptogramResult {
  /** Tajená věta tak, jak ji napsala učitelka. */
  phrase: string
  /** Věta po slovech a písmenech — tak se tiskne políčko vedle políčka. */
  phraseWords: string[][]
  rows: CryptogramRow[]
  /** Slova, na která ve větě nezbylo místo. */
  unusedEntries: PuzzleEntry[]
  problems: PuzzleProblem[]
}

export interface CryptogramInput {
  entries: PuzzleEntry[]
  phrase: string
  seed: string
}

/** Sestaví tajenku. Nic nevyhazuje — potíže vrací v `problems`. */
export function buildCryptogram(input: CryptogramInput): CryptogramResult {
  const rand = seededRandom(hashSeed(`tajenka:${input.seed}:${input.phrase}`))
  const problems: PuzzleProblem[] = []

  const words = phraseWords(input.phrase)
  const letters = words.flat()

  const usable: { entry: PuzzleEntry; letters: string[] }[] = []
  for (const entry of input.entries) {
    const split = splitWord(entry.word)
    if (split.unusable.length > 0) {
      problems.push({
        subject: entry.word,
        message: `Slovo „${entry.word}" obsahuje znaky, které se do políček zapsat nedají (${split.unusable.join(' ')}). Nech v něm jen písmena.`,
      })
    }
    if (split.letters.length < 2) {
      problems.push({
        subject: entry.word,
        message: `Slovo „${entry.word}" je na tajenku příliš krátké — potřebuje aspoň dvě písmena.`,
      })
      continue
    }
    if (!entry.clue.trim()) {
      problems.push({
        subject: entry.word,
        message: `Slovo „${entry.word}" nemá nápovědu; bez ní žák neví, co má do řádku napsat.`,
      })
      continue
    }
    usable.push({ entry, letters: split.letters })
  }

  if (letters.length === 0) {
    problems.push({ message: 'Tajenka nemá žádné písmeno — napiš větu, která se má z políček složit.' })
    return { phrase: input.phrase, phraseWords: words, rows: [], unusedEntries: usable.map((u) => u.entry), problems }
  }

  if (usable.length < letters.length) {
    problems.push({
      message: `Tajenka „${input.phrase}" má ${letters.length} písmen, ale použitelných slov je jen ${usable.length}. Přidej slova, nebo zvol kratší větu.`,
    })
  }

  /**
   * Přiřazení slov k písmenům je párování v bipartitním grafu (písmeno —
   * slovo, které to písmeno obsahuje). Hladový výběr by u české věty selhal
   * i tam, kde řešení existuje: vzácné písmeno si vezme slovo, které mezitím
   * spotřebovalo písmeno běžné. Proto se hledá největší párování rozšiřujícími
   * cestami (Kuhnův algoritmus) — když se některé písmeno nespáruje, je to
   * doopravdy nedostatek slov, ne smůla v pořadí.
   *
   * Pořadí kandidátů je zamíchané seedem, takže táž slova a týž seed dají
   * vždycky tutéž tajenku, ale dvě tajenky nad stejným seznamem nevyjdou
   * stejně.
   */
  const candidates = letters.map((letter) =>
    shuffled(
      usable.flatMap((item, index) => (item.letters.includes(letter) ? [index] : [])),
      rand,
    ),
  )

  /** Které písmeno drží které slovo; −1 = slovo je volné. */
  const takenBy = new Array<number>(usable.length).fill(-1)

  function assign(letterIndex: number, visited: boolean[]): boolean {
    for (const wordIndex of candidates[letterIndex] as number[]) {
      if (visited[wordIndex]) continue
      visited[wordIndex] = true
      const holder = takenBy[wordIndex] as number
      if (holder === -1 || assign(holder, visited)) {
        takenBy[wordIndex] = letterIndex
        return true
      }
    }
    return false
  }

  // Písmena s nejmenším výběrem slov jdou první — rozšiřujících cest je pak
  // potřeba nejmíň a výsledek nezávisí na pořadí písmen ve větě.
  const order = letters.map((_, i) => i).sort((a, b) => {
    const diff = (candidates[a] as number[]).length - (candidates[b] as number[]).length
    return diff !== 0 ? diff : a - b
  })

  const rowByIndex = new Map<number, CryptogramRow>()
  for (const letterIndex of order) {
    if (!assign(letterIndex, new Array<boolean>(usable.length).fill(false))) {
      const letter = letters[letterIndex] as string
      problems.push({
        subject: letter,
        message: `Na písmeno „${letter}" (${letterIndex + 1}. v tajence) nezbylo žádné slovo. Přidej slovo, které tohle písmeno obsahuje.`,
      })
    }
  }

  const used = new Set<PuzzleEntry>()
  takenBy.forEach((letterIndex, wordIndex) => {
    if (letterIndex === -1) return
    const item = usable[wordIndex] as (typeof usable)[number]
    const letter = letters[letterIndex] as string
    const positions = item.letters.flatMap((value, i) => (value === letter ? [i] : []))
    used.add(item.entry)
    rowByIndex.set(letterIndex, {
      number: letterIndex + 1,
      clue: item.entry.clue,
      word: item.entry.word,
      letters: item.letters,
      markedIndex: positions[Math.floor(rand() * positions.length)] as number,
      letter,
    })
  })

  const rows: CryptogramRow[] = []
  for (let i = 0; i < letters.length; i += 1) {
    const row = rowByIndex.get(i)
    if (row) rows.push(row)
  }

  return {
    phrase: input.phrase,
    phraseWords: words,
    rows,
    unusedEntries: usable.filter((item) => !used.has(item.entry)).map((item) => item.entry),
    problems,
  }
}

/**
 * O kolik prázdných políček se řádek odsadí, aby vyznačená políčka stála
 * pod sebou v jednom sloupci. Tak se tajenka tiskne v učebnicích i v
 * časopisech: žák ji čte svisle, ne že by ji sbíral z rozházených políček.
 */
export function markedOffsets(rows: CryptogramRow[]): number[] {
  const maxLeft = rows.reduce((max, row) => Math.max(max, row.markedIndex), 0)
  return rows.map((row) => maxLeft - row.markedIndex)
}

/** Věta složená z označených písmen — tím se ověřuje, že tajenka vyjde. */
export function readCryptogram(result: CryptogramResult): string {
  return result.rows.map((row) => row.letters[row.markedIndex] ?? '').join('')
}
