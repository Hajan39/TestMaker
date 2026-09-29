import { NoObjectGeneratedError } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  buildCryptogram,
  buildPuzzle,
  buildWordSearch,
  findWord,
  phraseWords,
  puzzleLetters,
  readCryptogram,
  solutionGrid,
  splitWord,
  WORD_SEARCH_BLOCKLIST,
  WORD_SEARCH_DIRECTIONS,
  type WordSearchPlacement,
} from '../src/puzzle/index'
import { generatePuzzleWords, type PuzzleWordsCall } from '../src/ai/puzzleWords'
import {
  PUZZLE_CLUE_MAX,
  PUZZLE_ENTRIES_MAX,
  PUZZLE_WORD_MAX,
  puzzleContentSchema,
  type PuzzleEntry,
} from '../src/schema/puzzle'

/** Buňky, na kterých umístění leží, jako „řádek,sloupec". */
function cellsOf(placement: WordSearchPlacement): string[] {
  return placement.letters.map(
    (_, i) => `${placement.row + placement.direction.dr * i},${placement.col + placement.direction.dc * i}`,
  )
}

/** Text bez háčků a čárek — tak sprosté slovo přečte i dítě. */
function bezDiakritiky(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '')
}

function slova(words: string[]): PuzzleEntry[] {
  return words.map((word) => ({ word, clue: `nápověda k ${word}` }))
}

const SLOVA: PuzzleEntry[] = [
  { word: 'kořen', clue: 'Poutá rostlinu v půdě' },
  { word: 'stonek', clue: 'Nese listy a květy' },
  { word: 'list', clue: 'Probíhá v něm fotosyntéza' },
  { word: 'květ', clue: 'Slouží k rozmnožování' },
  { word: 'plod', clue: 'Vzniká z květu' },
  { word: 'semeno', clue: 'Vyroste z něj nová rostlina' },
]

describe('písmena do buněk', () => {
  it('jedno písmeno je jedna buňka, háčky se zachovají', () => {
    expect(puzzleLetters('kořen')).toEqual(['K', 'O', 'Ř', 'E', 'N'])
  })

  it('spřežka ch zabere dvě buňky, ne jednu', () => {
    expect(puzzleLetters('chloroplast').slice(0, 2)).toEqual(['C', 'H'])
    expect(puzzleLetters('chloroplast')).toHaveLength(11)
  })

  it('mezery a spojovníky se do mřížky nezapisují', () => {
    expect(puzzleLetters('oxid uhličitý').join('')).toBe('OXIDUHLIČITÝ')
    // Obyčejný spojovník z klávesnice, ne jen typografické pomlčky.
    expect(splitWord('Česko-Slovensko')).toEqual({ letters: puzzleLetters('ČESKOSLOVENSKO'), unusable: [] })
    expect(splitWord('severo–západ').unusable).toEqual([])
  })

  it('rozložený zápis (NFD) dá stejná písmena jako složený', () => {
    const rozlozene = 'řeka'.normalize('NFD')
    expect(splitWord(rozlozene)).toEqual({ letters: ['Ř', 'E', 'K', 'A'], unusable: [] })
    expect(phraseWords('Úhoř'.normalize('NFD'))).toEqual([['Ú', 'H', 'O', 'Ř']])
  })

  it('věta tajenky se dělí na slova, aby šla přečíst', () => {
    expect(phraseWords('rostliny dýchají')).toEqual([
      ['R', 'O', 'S', 'T', 'L', 'I', 'N', 'Y'],
      ['D', 'Ý', 'C', 'H', 'A', 'J', 'Í'],
    ])
  })
})

describe('osmisměrka', () => {
  it('týž seed dá tutéž mřížku, jiný seed jinou', () => {
    const a = buildWordSearch({ entries: SLOVA, cols: 12, rows: 12, seed: 'abc' })
    const b = buildWordSearch({ entries: SLOVA, cols: 12, rows: 12, seed: 'abc' })
    const c = buildWordSearch({ entries: SLOVA, cols: 12, rows: 12, seed: 'xyz' })

    expect(b.grid).toEqual(a.grid)
    expect(b.placements).toEqual(a.placements)
    expect(c.grid).not.toEqual(a.grid)
  })

  it('každé zadané slovo v mřížce opravdu leží', () => {
    const result = buildWordSearch({ entries: SLOVA, cols: 12, rows: 12, seed: 'rostliny' })
    expect(result.unplaced).toEqual([])
    expect(result.problems).toEqual([])

    for (const entry of SLOVA) {
      const found = findWord(result.grid, entry.word)
      expect(found.length, `slovo ${entry.word} se v mřížce nenašlo`).toBeGreaterThan(0)
    }
  })

  it('mřížka má zadanou velikost a samá písmena', () => {
    const result = buildWordSearch({ entries: SLOVA, cols: 10, rows: 8, seed: '1' })
    expect(result.grid).toHaveLength(8)
    for (const row of result.grid) {
      expect(row).toHaveLength(10)
      for (const cell of row) expect(cell).toMatch(/^\p{Lu}$/u)
    }
  })

  it('slovo jde umístit ve všech osmi směrech', () => {
    for (const direction of WORD_SEARCH_DIRECTIONS) {
      const result = buildWordSearch({
        entries: [{ word: 'stonek', clue: 'Nese listy' }],
        cols: 10,
        rows: 10,
        seed: `smer-${direction.label}`,
        directions: [direction],
      })
      const placement = result.placements[0]
      expect(placement, `směr ${direction.label} nic neumístil`).toBeTruthy()
      expect(placement!.direction).toEqual(direction)

      // Co se umístilo, musí jít v mřížce i najít — a to právě v tomhle směru.
      const found = findWord(result.grid, 'stonek')
      expect(found.some((item) => item.direction.label === direction.label)).toBe(true)
    }
  })

  it('slovo, které se do mřížky nevejde, se ohlásí a nikam se nevloží', () => {
    const result = buildWordSearch({
      entries: [
        { word: 'fotosyntéza', clue: 'Děj v listech' },
        { word: 'list', clue: 'Probíhá v něm fotosyntéza' },
      ],
      cols: 6,
      rows: 6,
      seed: '1',
    })

    expect(result.unplaced).toContain('fotosyntéza')
    expect(result.problems.map((problem) => problem.message).join(' ')).toContain('nevejde')
    expect(result.placements.map((placement) => placement.word)).toEqual(['list'])
    expect(findWord(result.grid, 'fotosyntéza')).toEqual([])
  })

  it('duplicitní slovo se ohlásí a v mřížce je jen jednou', () => {
    const result = buildWordSearch({
      entries: [
        { word: 'list', clue: 'Zelený orgán' },
        { word: 'LIST', clue: 'Totéž podruhé' },
      ],
      cols: 8,
      rows: 8,
      seed: '1',
    })
    expect(result.placements).toHaveLength(1)
    expect(result.problems.map((problem) => problem.message).join(' ')).toContain('podruhé')
  })

  it('krátké slovo nikdy neleží celé uvnitř delšího', () => {
    const result = buildWordSearch({ entries: slova(['lesník', 'les']), cols: 10, rows: 10, seed: '12' })
    const lesnik = result.placements.find((p) => p.word === 'lesník')
    const les = result.placements.find((p) => p.word === 'les')
    expect(lesnik && les).toBeTruthy()
    const bunkyLesniku = new Set(cellsOf(lesnik!))
    expect(cellsOf(les!).every((cell) => bunkyLesniku.has(cell))).toBe(false)
    // Žák najde „les" i uvnitř „lesníku" — to se učitelce musí říct.
    expect(result.problems.map((problem) => problem.message).join(' ')).toContain('lesník')
  })

  it('slovo a jeho obrácení neleží na týchž buňkách', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const result = buildWordSearch({ entries: slova(['ret', 'ter']), cols: 8, rows: 8, seed: String(seed) })
      const [a, b] = result.placements
      expect(new Set([...cellsOf(a!), ...cellsOf(b!)]).size, `seed ${seed}`).toBeGreaterThan(3)
    }
  })

  it('slovo ze seznamu je v mřížce jen jednou (ani výplň ho nevytvoří podruhé)', () => {
    const words = ['oko', 'nos', 'ucho', 'kost', 'sval', 'krev', 'žebro', 'plíce', 'srdce', 'lebka']
    for (let seed = 0; seed < 60; seed += 1) {
      const result = buildWordSearch({ entries: slova(words), cols: 16, rows: 16, seed: String(seed) })
      expect(result.unplaced).toEqual([])
      for (const placement of result.placements) {
        const palindrom = placement.letters.join('') === [...placement.letters].reverse().join('')
        expect(findWord(result.grid, placement.word).length, `${placement.word}, seed ${seed}`).toBe(
          palindrom ? 2 : 1,
        )
      }
    }
  })

  it('výplň nevytvoří sprosté slovo v žádném směru', () => {
    const words = ['kurz', 'pivo', 'hora', 'kolo', 'debata', 'sova', 'pára', 'kotel']
    for (let seed = 0; seed < 300; seed += 1) {
      const result = buildWordSearch({ entries: slova(words), cols: 14, rows: 14, seed: String(seed) })
      const grid = result.grid.map((row) => row.map(bezDiakritiky))
      for (const vulgar of WORD_SEARCH_BLOCKLIST) {
        expect(findWord(grid, bezDiakritiky(vulgar)), `${vulgar}, seed ${seed}`).toEqual([])
      }
    }
  })

  it('výplň z malého počtu písmen bere celou českou abecedu i s Ď a Ů', () => {
    const counts = new Map<string, number>()
    for (let seed = 0; seed < 80; seed += 1) {
      const result = buildWordSearch({ entries: slova(['ďas', 'dům']), cols: 12, rows: 12, seed: String(seed) })
      const solution = solutionGrid(result)
      result.grid.forEach((row, r) =>
        row.forEach((cell, c) => {
          if (solution[r]?.[c] === null) counts.set(cell, (counts.get(cell) ?? 0) + 1)
        }),
      )
    }
    expect(counts.get('Ď') ?? 0).toBeGreaterThan(0)
    expect(counts.get('Ů') ?? 0).toBeGreaterThan(0)
    // Běžná písmena jsou častější než vzácná — výplň vypadá jako čeština.
    expect(counts.get('O') ?? 0).toBeGreaterThan(counts.get('Ď') ?? 0)
    expect(counts.get('E') ?? 0).toBeGreaterThan(counts.get('Ů') ?? 0)
  })

  it('klíč pro učitelku ukazuje jen písmena hledaných slov', () => {
    const result = buildWordSearch({ entries: SLOVA, cols: 12, rows: 12, seed: 'klic' })
    const solution = solutionGrid(result)
    const filled = solution.flat().filter((cell) => cell !== null)
    const letters = result.placements.reduce((sum, placement) => sum + placement.letters.length, 0)

    // Překryvy znamenají, že vyplněných buněk je nejvýš tolik co písmen.
    expect(filled.length).toBeGreaterThan(0)
    expect(filled.length).toBeLessThanOrEqual(letters)
    for (const placement of result.placements) {
      const { row, col, direction } = placement
      placement.letters.forEach((letter, i) => {
        expect(solution[row + direction.dr * i]?.[col + direction.dc * i]).toBe(letter)
      })
    }
  })
})

describe('tajenka', () => {
  const SLOVNIK: PuzzleEntry[] = [
    { word: 'kořen', clue: 'Poutá rostlinu v půdě' },
    { word: 'stonek', clue: 'Nese listy a květy' },
    { word: 'list', clue: 'Probíhá v něm fotosyntéza' },
    { word: 'plod', clue: 'Vzniká z květu' },
    { word: 'semeno', clue: 'Vyroste z něj rostlina' },
    { word: 'voda', clue: 'Bez ní rostlina uschne' },
    { word: 'světlo', clue: 'Pohání fotosyntézu' },
    { word: 'půda', clue: 'Roste v ní kořen' },
  ]

  it('z vyznačených písmen se složí zadaná věta', () => {
    const result = buildCryptogram({ entries: SLOVNIK, phrase: 'pod list', seed: '1' })

    expect(result.problems).toEqual([])
    expect(result.rows).toHaveLength(7)
    expect(readCryptogram(result)).toBe('PODLIST')
    // Každé vyznačené políčko opravdu drží písmeno tajenky.
    result.rows.forEach((row, i) => {
      expect(row.letters[row.markedIndex]).toBe(puzzleLetters('podlist')[i])
      expect(row.word).toBeTruthy()
    })
  })

  it('žádné slovo se nepoužije dvakrát', () => {
    const result = buildCryptogram({ entries: SLOVNIK, phrase: 'voda', seed: '7' })
    const words = result.rows.map((row) => row.word)
    expect(new Set(words).size).toBe(words.length)
  })

  it('číslice ve větě tajenky se ohlásí, ne tiše zahodí', () => {
    const result = buildCryptogram({ entries: SLOVNIK, phrase: 'Rok 1348', seed: '1' })
    const zprava = result.problems.map((problem) => problem.message).join(' ')
    expect(zprava).toContain('1 3 4 8')
  })

  it('totéž slovo zadané víckrát se ohlásí a použije se jen jednou', () => {
    const result = buildCryptogram({
      entries: [
        { word: 'les', clue: 'Roste v něm hodně stromů' },
        { word: 'LES', clue: 'Totéž podruhé' },
        { word: 'les', clue: 'A potřetí' },
      ],
      phrase: 'les',
      seed: '1',
    })
    expect(result.rows.length).toBeLessThanOrEqual(1)
    expect(result.problems.map((problem) => problem.message).join(' ')).toContain('podruhé')
  })

  it('nápověda, která obsahuje samo slovo, se ohlásí', () => {
    const result = buildCryptogram({
      entries: [
        { word: 'kořen', clue: 'KOREN drží rostlinu v půdě' },
        { word: 'stonek', clue: 'Nese listy a květy' },
      ],
      phrase: 'ko',
      seed: '1',
    })
    const potize = result.problems.filter((problem) => problem.subject === 'kořen')
    expect(potize.map((problem) => problem.message).join(' ')).toContain('nápověd')
    expect(result.problems.some((problem) => problem.subject === 'stonek')).toBe(false)
  })

  it('týž seed dá tutéž tajenku', () => {
    const a = buildCryptogram({ entries: SLOVNIK, phrase: 'plod', seed: 'q' })
    const b = buildCryptogram({ entries: SLOVNIK, phrase: 'plod', seed: 'q' })
    expect(b.rows).toEqual(a.rows)
  })

  it('písmeno, na které nezbylo slovo, se ohlásí místo tichého vynechání', () => {
    const result = buildCryptogram({
      entries: [
        { word: 'list', clue: 'Zelený orgán' },
        { word: 'plod', clue: 'Vzniká z květu' },
      ],
      phrase: 'žíly',
      seed: '1',
    })

    const zprava = result.problems.map((problem) => problem.message).join(' ')
    expect(zprava).toContain('Ž')
    expect(result.rows.length).toBeLessThan(puzzleLetters('žíly').length)
  })

  it('krátká věta nechá zbylá slova stranou', () => {
    const result = buildCryptogram({ entries: SLOVNIK, phrase: 'led', seed: '3' })
    expect(readCryptogram(result)).toBe('LED')
    expect(result.unusedEntries.length).toBe(SLOVNIK.length - 3)
  })

  it('tajenka se dvěma slovy se tiskne po slovech', () => {
    const result = buildCryptogram({ entries: SLOVNIK, phrase: 'do půdy', seed: '2' })
    expect(result.phraseWords).toEqual([
      ['D', 'O'],
      ['P', 'Ů', 'D', 'Y'],
    ])
    // Písmeno „Y" v seznamu není — tajenka to musí říct, ne ho tiše vynechat.
    expect(result.problems.map((problem) => problem.subject)).toContain('Y')
  })
})

describe('slova od modelu', () => {
  it('odpověď ve špatném tvaru zkusí dalším modelem', async () => {
    const volani: string[] = []
    const call: PuzzleWordsCall = async ({ config }) => {
      volani.push(config.model)
      if (config.model === 'a') {
        throw new NoObjectGeneratedError({
          message: 'x',
          text: '{}',
          response: {} as never,
          usage: {} as never,
          finishReason: 'stop',
        })
      }
      return { words: [{ word: 'houba', clue: 'Roste v lese a má klobouk.' }] }
    }
    const vysledek = await generatePuzzleWords(
      { text: 'Houba roste v lese.', topicName: 'Houby', subjectName: 'Přírodopis', gradeName: null, count: 1, kind: 'wordsearch' },
      { models: [{ provider: 'google', model: 'a' }, { provider: 'google', model: 'b' }], callModel: call },
    )
    expect(volani).toEqual(['a', 'b'])
    expect(vysledek.entries.map((e) => e.word)).toEqual(['houba'])
  })
})

describe('hlavolam ze schématu', () => {
  it('schéma doplní výchozí hodnoty a hlavolam se z nich složí', () => {
    const puzzle = puzzleContentSchema.parse({
      kind: 'wordsearch',
      title: 'Části rostliny',
      entries: SLOVA,
      payload: { seed: 'a' },
    })
    if (puzzle.kind === 'wordsearch') expect(puzzle.payload.cols).toBe(12)

    const built = buildPuzzle(puzzle)
    expect(built.kind).toBe('wordsearch')
    if (built.kind === 'wordsearch') {
      expect(built.wordSearch.placements).toHaveLength(SLOVA.length)
    }
  })

  it('u osmisměrky nápověda není povinná, u tajenky ano', () => {
    const osmismerka = puzzleContentSchema.safeParse({
      kind: 'wordsearch',
      title: 'Bez nápověd',
      entries: [{ word: 'kořen' }, { word: 'list', clue: '' }],
      payload: {},
    })
    expect(osmismerka.success).toBe(true)
    if (osmismerka.success) expect(osmismerka.data.entries.map((entry) => entry.clue)).toEqual(['', ''])

    const tajenka = puzzleContentSchema.safeParse({
      kind: 'cryptogram',
      title: 'Bez nápověd',
      entries: [
        { word: 'kořen', clue: '' },
        { word: 'list', clue: 'Zelený' },
      ],
      payload: { phrase: 'ko' },
    })
    expect(tajenka.success).toBe(false)
  })

  it('meze slov a nápověd jsou k dispozici jako konstanty', () => {
    expect(PUZZLE_CLUE_MAX).toBe(200)
    expect(PUZZLE_WORD_MAX).toBe(24)
    expect(PUZZLE_ENTRIES_MAX).toBe(40)
    const prilisDlouha = puzzleContentSchema.safeParse({
      kind: 'wordsearch',
      title: 'x',
      entries: [{ word: 'kořen', clue: 'a'.repeat(PUZZLE_CLUE_MAX + 1) }, { word: 'list' }],
      payload: {},
    })
    expect(prilisDlouha.success).toBe(false)
  })

  it('tajenka se ze schématu složí stejně jako přímým voláním', () => {
    const puzzle = puzzleContentSchema.parse({
      kind: 'cryptogram',
      title: 'Tajenka',
      entries: SLOVA,
      payload: { phrase: 'les', seed: 'b' },
    })
    const built = buildPuzzle(puzzle)
    expect(built.kind).toBe('cryptogram')
    if (built.kind === 'cryptogram') {
      expect(readCryptogram(built.cryptogram)).toBe('LES')
    }
  })
})
