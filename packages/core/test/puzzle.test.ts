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

/** Cells a placement lies on, as "row,col". */
function cellsOf(placement: WordSearchPlacement): string[] {
  return placement.letters.map(
    (_, i) => `${placement.row + placement.direction.dr * i},${placement.col + placement.direction.dc * i}`,
  )
}

/** Text without diacritics — that is how a child reads a vulgar word too. */
function withoutDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '')
}

function toEntries(words: string[]): PuzzleEntry[] {
  return words.map((word) => ({ word, clue: `nápověda k ${word}` }))
}

const WORDS: PuzzleEntry[] = [
  { word: 'kořen', clue: 'Poutá rostlinu v půdě' },
  { word: 'stonek', clue: 'Nese listy a květy' },
  { word: 'list', clue: 'Probíhá v něm fotosyntéza' },
  { word: 'květ', clue: 'Slouží k rozmnožování' },
  { word: 'plod', clue: 'Vzniká z květu' },
  { word: 'semeno', clue: 'Vyroste z něj nová rostlina' },
]

describe('letters into cells', () => {
  it('one letter is one cell, diacritics are kept', () => {
    expect(puzzleLetters('kořen')).toEqual(['K', 'O', 'Ř', 'E', 'N'])
  })

  it('the digraph ch takes two cells, not one', () => {
    expect(puzzleLetters('chloroplast').slice(0, 2)).toEqual(['C', 'H'])
    expect(puzzleLetters('chloroplast')).toHaveLength(11)
  })

  it('spaces and hyphens are not written into the grid', () => {
    expect(puzzleLetters('oxid uhličitý').join('')).toBe('OXIDUHLIČITÝ')
    // The plain keyboard hyphen, not just typographic dashes.
    expect(splitWord('Česko-Slovensko')).toEqual({ letters: puzzleLetters('ČESKOSLOVENSKO'), unusable: [] })
    expect(splitWord('severo–západ').unusable).toEqual([])
  })

  it('decomposed text (NFD) gives the same letters as composed', () => {
    const decomposed = 'řeka'.normalize('NFD')
    expect(splitWord(decomposed)).toEqual({ letters: ['Ř', 'E', 'K', 'A'], unusable: [] })
    expect(phraseWords('Úhoř'.normalize('NFD'))).toEqual([['Ú', 'H', 'O', 'Ř']])
  })

  it('the cryptogram phrase is split into words so it can be read', () => {
    expect(phraseWords('rostliny dýchají')).toEqual([
      ['R', 'O', 'S', 'T', 'L', 'I', 'N', 'Y'],
      ['D', 'Ý', 'C', 'H', 'A', 'J', 'Í'],
    ])
  })
})

describe('word search', () => {
  it('the same seed gives the same grid, a different seed a different one', () => {
    const a = buildWordSearch({ entries: WORDS, cols: 12, rows: 12, seed: 'abc' })
    const b = buildWordSearch({ entries: WORDS, cols: 12, rows: 12, seed: 'abc' })
    const c = buildWordSearch({ entries: WORDS, cols: 12, rows: 12, seed: 'xyz' })

    expect(b.grid).toEqual(a.grid)
    expect(b.placements).toEqual(a.placements)
    expect(c.grid).not.toEqual(a.grid)
  })

  it('every given word really lies in the grid', () => {
    const result = buildWordSearch({ entries: WORDS, cols: 12, rows: 12, seed: 'rostliny' })
    expect(result.unplaced).toEqual([])
    expect(result.problems).toEqual([])

    for (const entry of WORDS) {
      const found = findWord(result.grid, entry.word)
      expect(found.length, `word ${entry.word} not found in the grid`).toBeGreaterThan(0)
    }
  })

  it('the grid has the given size and only letters', () => {
    const result = buildWordSearch({ entries: WORDS, cols: 10, rows: 8, seed: '1' })
    expect(result.grid).toHaveLength(8)
    for (const row of result.grid) {
      expect(row).toHaveLength(10)
      for (const cell of row) expect(cell).toMatch(/^\p{Lu}$/u)
    }
  })

  it('a word can be placed in all eight directions', () => {
    for (const direction of WORD_SEARCH_DIRECTIONS) {
      const result = buildWordSearch({
        entries: [{ word: 'stonek', clue: 'Nese listy' }],
        cols: 10,
        rows: 10,
        seed: `direction-${direction.name}`,
        directions: [direction],
      })
      const placement = result.placements[0]
      expect(placement, `direction ${direction.name} placed nothing`).toBeTruthy()
      expect(placement!.direction).toEqual(direction)

      // Whatever was placed must be findable in the grid — in exactly this direction.
      const found = findWord(result.grid, 'stonek')
      expect(found.some((item) => item.direction.name === direction.name)).toBe(true)
    }
  })

  it('a word that does not fit the grid is reported and not placed', () => {
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

  it('a duplicate word is reported and is in the grid only once', () => {
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

  it('a short word never lies entirely inside a longer one', () => {
    const result = buildWordSearch({ entries: toEntries(['lesník', 'les']), cols: 10, rows: 10, seed: '12' })
    const forester = result.placements.find((p) => p.word === 'lesník')
    const forest = result.placements.find((p) => p.word === 'les')
    expect(forester && forest).toBeTruthy()
    const foresterCells = new Set(cellsOf(forester!))
    expect(cellsOf(forest!).every((cell) => foresterCells.has(cell))).toBe(false)
    // The pupil finds "les" inside "lesníku" too — the teacher must be told.
    expect(result.problems.map((problem) => problem.message).join(' ')).toContain('lesník')
  })

  it('a word and its reverse do not lie on the same cells', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const result = buildWordSearch({ entries: toEntries(['ret', 'ter']), cols: 8, rows: 8, seed: String(seed) })
      const [a, b] = result.placements
      expect(new Set([...cellsOf(a!), ...cellsOf(b!)]).size, `seed ${seed}`).toBeGreaterThan(3)
    }
  })

  it('a listed word is in the grid only once (the filler does not create it again)', () => {
    const words = ['oko', 'nos', 'ucho', 'kost', 'sval', 'krev', 'žebro', 'plíce', 'srdce', 'lebka']
    for (let seed = 0; seed < 60; seed += 1) {
      const result = buildWordSearch({ entries: toEntries(words), cols: 16, rows: 16, seed: String(seed) })
      expect(result.unplaced).toEqual([])
      for (const placement of result.placements) {
        const palindrome = placement.letters.join('') === [...placement.letters].reverse().join('')
        expect(findWord(result.grid, placement.word).length, `${placement.word}, seed ${seed}`).toBe(
          palindrome ? 2 : 1,
        )
      }
    }
  })

  it('the filler does not spell a vulgar word in any direction', () => {
    const words = ['kurz', 'pivo', 'hora', 'kolo', 'debata', 'sova', 'pára', 'kotel']
    for (let seed = 0; seed < 300; seed += 1) {
      const result = buildWordSearch({ entries: toEntries(words), cols: 14, rows: 14, seed: String(seed) })
      const grid = result.grid.map((row) => row.map(withoutDiacritics))
      for (const vulgar of WORD_SEARCH_BLOCKLIST) {
        expect(findWord(grid, withoutDiacritics(vulgar)), `${vulgar}, seed ${seed}`).toEqual([])
      }
    }
  })

  it('filler from few letters uses the whole Czech alphabet including Ď and Ů', () => {
    const counts = new Map<string, number>()
    for (let seed = 0; seed < 80; seed += 1) {
      const result = buildWordSearch({ entries: toEntries(['ďas', 'dům']), cols: 12, rows: 12, seed: String(seed) })
      const solution = solutionGrid(result)
      result.grid.forEach((row, r) =>
        row.forEach((cell, c) => {
          if (solution[r]?.[c] === null) counts.set(cell, (counts.get(cell) ?? 0) + 1)
        }),
      )
    }
    expect(counts.get('Ď') ?? 0).toBeGreaterThan(0)
    expect(counts.get('Ů') ?? 0).toBeGreaterThan(0)
    // Common letters are more frequent than rare ones — the filler looks like Czech.
    expect(counts.get('O') ?? 0).toBeGreaterThan(counts.get('Ď') ?? 0)
    expect(counts.get('E') ?? 0).toBeGreaterThan(counts.get('Ů') ?? 0)
  })

  it("the teacher's key shows only the letters of the hidden words", () => {
    const result = buildWordSearch({ entries: WORDS, cols: 12, rows: 12, seed: 'klic' })
    const solution = solutionGrid(result)
    const filled = solution.flat().filter((cell) => cell !== null)
    const letters = result.placements.reduce((sum, placement) => sum + placement.letters.length, 0)

    // Overlaps mean there are at most as many filled cells as letters.
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

describe('cryptogram', () => {
  const DICTIONARY: PuzzleEntry[] = [
    { word: 'kořen', clue: 'Poutá rostlinu v půdě' },
    { word: 'stonek', clue: 'Nese listy a květy' },
    { word: 'list', clue: 'Probíhá v něm fotosyntéza' },
    { word: 'plod', clue: 'Vzniká z květu' },
    { word: 'semeno', clue: 'Vyroste z něj rostlina' },
    { word: 'voda', clue: 'Bez ní rostlina uschne' },
    { word: 'světlo', clue: 'Pohání fotosyntézu' },
    { word: 'půda', clue: 'Roste v ní kořen' },
  ]

  it('the marked letters spell the given phrase', () => {
    const result = buildCryptogram({ entries: DICTIONARY, phrase: 'pod list', seed: '1' })

    expect(result.problems).toEqual([])
    expect(result.rows).toHaveLength(7)
    expect(readCryptogram(result)).toBe('PODLIST')
    // Every marked cell really holds a phrase letter.
    result.rows.forEach((row, i) => {
      expect(row.letters[row.markedIndex]).toBe(puzzleLetters('podlist')[i])
      expect(row.word).toBeTruthy()
    })
  })

  it('no word is used twice', () => {
    const result = buildCryptogram({ entries: DICTIONARY, phrase: 'voda', seed: '7' })
    const words = result.rows.map((row) => row.word)
    expect(new Set(words).size).toBe(words.length)
  })

  it('digits in the phrase are reported, not silently dropped', () => {
    const result = buildCryptogram({ entries: DICTIONARY, phrase: 'Rok 1348', seed: '1' })
    const message = result.problems.map((problem) => problem.message).join(' ')
    expect(message).toContain('1 3 4 8')
  })

  it('the same word given repeatedly is reported and used only once', () => {
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

  it('a clue containing the word itself is reported', () => {
    const result = buildCryptogram({
      entries: [
        { word: 'kořen', clue: 'KOREN drží rostlinu v půdě' },
        { word: 'stonek', clue: 'Nese listy a květy' },
      ],
      phrase: 'ko',
      seed: '1',
    })
    const problems = result.problems.filter((problem) => problem.subject === 'kořen')
    expect(problems.map((problem) => problem.message).join(' ')).toContain('nápověd')
    expect(result.problems.some((problem) => problem.subject === 'stonek')).toBe(false)
  })

  it('the same seed gives the same cryptogram', () => {
    const a = buildCryptogram({ entries: DICTIONARY, phrase: 'plod', seed: 'q' })
    const b = buildCryptogram({ entries: DICTIONARY, phrase: 'plod', seed: 'q' })
    expect(b.rows).toEqual(a.rows)
  })

  it('a letter left without a word is reported instead of silently skipped', () => {
    const result = buildCryptogram({
      entries: [
        { word: 'list', clue: 'Zelený orgán' },
        { word: 'plod', clue: 'Vzniká z květu' },
      ],
      phrase: 'žíly',
      seed: '1',
    })

    const message = result.problems.map((problem) => problem.message).join(' ')
    expect(message).toContain('Ž')
    expect(result.rows.length).toBeLessThan(puzzleLetters('žíly').length)
  })

  it('a short phrase leaves the remaining words aside', () => {
    const result = buildCryptogram({ entries: DICTIONARY, phrase: 'led', seed: '3' })
    expect(readCryptogram(result)).toBe('LED')
    expect(result.unusedEntries.length).toBe(DICTIONARY.length - 3)
  })

  it('a two-word cryptogram prints word by word', () => {
    const result = buildCryptogram({ entries: DICTIONARY, phrase: 'do půdy', seed: '2' })
    expect(result.phraseWords).toEqual([
      ['D', 'O'],
      ['P', 'Ů', 'D', 'Y'],
    ])
    // The letter "Y" is not in the list — the cryptogram must say so, not skip it silently.
    expect(result.problems.map((problem) => problem.subject)).toContain('Y')
  })
})

describe('words from the model', () => {
  it('a malformed response is retried with the next model', async () => {
    const calls: string[] = []
    const call: PuzzleWordsCall = async ({ config }) => {
      calls.push(config.model)
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
    const result = await generatePuzzleWords(
      { text: 'Houba roste v lese.', topicName: 'Houby', subjectName: 'Přírodopis', gradeName: null, count: 1, kind: 'wordsearch' },
      { models: [{ provider: 'google', model: 'a' }, { provider: 'google', model: 'b' }], callModel: call },
    )
    expect(calls).toEqual(['a', 'b'])
    expect(result.entries.map((e) => e.word)).toEqual(['houba'])
  })
})

describe('puzzle from the schema', () => {
  it('the schema fills in defaults and the puzzle builds from them', () => {
    const puzzle = puzzleContentSchema.parse({
      kind: 'wordsearch',
      title: 'Části rostliny',
      entries: WORDS,
      payload: { seed: 'a' },
    })
    if (puzzle.kind === 'wordsearch') expect(puzzle.payload.cols).toBe(12)

    const built = buildPuzzle(puzzle)
    expect(built.kind).toBe('wordsearch')
    if (built.kind === 'wordsearch') {
      expect(built.wordSearch.placements).toHaveLength(WORDS.length)
    }
  })

  it('a clue is optional for a word search but required for a cryptogram', () => {
    const wordsearch = puzzleContentSchema.safeParse({
      kind: 'wordsearch',
      title: 'Bez nápověd',
      entries: [{ word: 'kořen' }, { word: 'list', clue: '' }],
      payload: {},
    })
    expect(wordsearch.success).toBe(true)
    if (wordsearch.success) expect(wordsearch.data.entries.map((entry) => entry.clue)).toEqual(['', ''])

    const secretPhrase = puzzleContentSchema.safeParse({
      kind: 'cryptogram',
      title: 'Bez nápověd',
      entries: [
        { word: 'kořen', clue: '' },
        { word: 'list', clue: 'Zelený' },
      ],
      payload: { phrase: 'ko' },
    })
    expect(secretPhrase.success).toBe(false)
  })

  it('word and clue limits are available as constants', () => {
    expect(PUZZLE_CLUE_MAX).toBe(200)
    expect(PUZZLE_WORD_MAX).toBe(24)
    expect(PUZZLE_ENTRIES_MAX).toBe(40)
    const tooLong = puzzleContentSchema.safeParse({
      kind: 'wordsearch',
      title: 'x',
      entries: [{ word: 'kořen', clue: 'a'.repeat(PUZZLE_CLUE_MAX + 1) }, { word: 'list' }],
      payload: {},
    })
    expect(tooLong.success).toBe(false)
  })

  it('a cryptogram from the schema builds the same as by a direct call', () => {
    const puzzle = puzzleContentSchema.parse({
      kind: 'cryptogram',
      title: 'Tajenka',
      entries: WORDS,
      payload: { phrase: 'les', seed: 'b' },
    })
    const built = buildPuzzle(puzzle)
    expect(built.kind).toBe('cryptogram')
    if (built.kind === 'cryptogram') {
      expect(readCryptogram(built.cryptogram)).toBe('LES')
    }
  })
})
