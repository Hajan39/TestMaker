/**
 * Puzzle printing: page breaking, height estimate against the real PDF and
 * what may (and may not) end up on paper.
 *
 * The cases are those where printing used to fall apart: a 20 × 20 word search
 * with clues, a cryptogram with a long phrase and the key of a large word
 * search. React-pdf does not move an unbreakable block taller than a page but
 * squashes it onto one page — overlapping clues, a mashed grid, a word list
 * off the paper.
 */
import { createElement } from 'react'
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/extract/uint8array-polyfill'
import { TestDocument, PuzzleView } from '../src/pdf/TestDocument'
import { registerServerFonts } from '../src/pdf/node'
import { estimateHeight, paginate, usablePageHeight } from '../src/pdf/estimate'
import { cryptogramLayout, puzzleForVariant, PUZZLE_USABLE_WIDTH, CRYPTOGRAM_NUMBER_WIDTH } from '../src/pdf/layout'
import { pagePadding, mm } from '../src/pdf/styles'
import { buildPuzzle } from '../src/puzzle/index'
import { puzzleContentSchema, puzzleInstructions, type PuzzleContent } from '../src/schema/puzzle'
import type { RenderableTest, ResolvedTestItem } from '../src/schema/test'
import { makeItems, makeTemplate, makeTest } from './fixtures'

registerServerFonts()

const TEMPLATES = ['klasicka', 'kompaktni', 'pracovni-list'] as const

const WORDS: [string, string][] = [
  ['průdušnice', 'Trubice vyztužená chrupavčitými prstenci, kterou proudí vzduch z hrtanu do průdušek.'],
  ['fotosyntéza', 'Děj, při kterém zelená rostlina vyrábí ze vzduchu a vody cukr pomocí světla.'],
  ['chlorofyl', 'Zelené barvivo v chloroplastech, které zachytává sluneční světlo.'],
  ['průduchy', 'Drobné otvory na spodní straně listu, kterými rostlina dýchá a odpařuje vodu.'],
  ['bránice', 'Plochý sval oddělující hrudní dutinu od břišní; při nádechu se oplošťuje.'],
  ['hrtan', 'Chrupavčitý orgán s hlasivkami.'],
  ['plíce', 'Párový orgán, ve kterém probíhá výměna plynů.'],
  ['sklípky', 'Drobné váčky na konci průdušinek opředené vlásečnicemi.'],
  ['žebra', 'Kosti chránící hrudník.'],
  ['nosohltan', 'Prostor za dutinou nosní, kde se kříží cesta vzduchu a potravy.'],
  ['hlasivky', 'Vazy v hrtanu, jejichž chvěním vzniká hlas.'],
  ['příklopka', 'Chrupavka, která při polykání uzavře vchod do hrtanu.'],
  ['kyslík', 'Plyn, který krev roznáší z plic do celého těla.'],
  ['oxid uhličitý', 'Plyn, který vydechujeme.'],
  ['vlásečnice', 'Nejtenčí cévy v těle.'],
  ['červené krvinky', 'Krvinky přenášející kyslík díky hemoglobinu.'],
  ['hemoglobin', 'Červené krevní barvivo, na které se váže kyslík.'],
  ['dýchání', 'Výměna plynů mezi organismem a prostředím.'],
  ['nádech', 'Vdechnutí vzduchu do plic.'],
  ['výdech', 'Vydechnutí vzduchu z plic.'],
  ['mezižeberní svaly', 'Svaly mezi žebry, které zvedají hrudník.'],
  ['pohrudnice', 'Blána pokrývající plíce a vnitřní stěnu hrudníku.'],
  ['astma', 'Onemocnění, při kterém se zužují průdušky.'],
  ['kašel', 'Obranný reflex, který čistí dýchací cesty.'],
  ['rýma', 'Zánět nosní sliznice.'],
  ['řasinky', 'Drobné výběžky buněk, které vymetají hlen z dýchacích cest.'],
  ['hlen', 'Lepkavá tekutina zachytávající prach.'],
  ['dutina nosní', 'Místo, kde se vzduch ohřívá, zvlhčuje a čistí.'],
  ['průdušky', 'Dvě větve, na které se dělí průdušnice.'],
  ['průdušinky', 'Nejjemnější větvení průdušek.'],
  ['kouření', 'Zlozvyk, který poškozuje plíce.'],
  ['spirometr', 'Přístroj na měření objemu plic.'],
  ['žábry', 'Dýchací orgán ryb.'],
  ['vzdušnice', 'Dýchací trubičky hmyzu.'],
  ['chřipka', 'Virové onemocnění dýchacích cest.'],
  ['zápal plic', 'Zánět plicní tkáně.'],
  ['hrudník', 'Část těla chráněná žebry.'],
  ['ústní dutina', 'Tudy můžeme také dýchat.'],
  ['čichové buňky', 'Buňky v nose, kterými cítíme vůně.'],
  ['živočichové', 'Organismy, které dýchají kyslík.'],
]

const entries = (n: number) => WORDS.slice(0, n).map(([word, clue]) => ({ word, clue }))

const wordsearch = (o: { size: number; n: number; clues?: boolean; title?: string }): PuzzleContent =>
  puzzleContentSchema.parse({
    kind: 'wordsearch',
    title: o.title ?? `Osmisměrka ${o.size}×${o.size}`,
    entries: entries(o.n),
    payload: { cols: o.size, rows: o.size, seed: 'audit', showClues: !!o.clues },
  })

const cryptogram = (phrase: string, title = `Tajenka: ${phrase}`): PuzzleContent =>
  puzzleContentSchema.parse({ kind: 'cryptogram', title, entries: entries(40), payload: { phrase, seed: 'audit' } })

const WS20_CLUES = wordsearch({ size: 20, n: 40, clues: true })
const WS20 = wordsearch({ size: 20, n: 40 })
const CRYPTO = cryptogram('Kyslík pro život')
const CRYPTO_LONG = cryptogram('Dýchání je výměna plynů v plicích', 'Tajenka o dýchání')
/** No word is left for „J“ and „Ě“ in the phrase — rows 8 and 13 are missing. */
const CRYPTO_MISSING = CRYPTO_LONG

const puzzleItem = (puzzle: PuzzleContent, id = 'pz'): ResolvedTestItem => ({
  id,
  testId: 'test-1',
  order: 50,
  kind: 'puzzle',
  questionId: null,
  text: null,
  pointsOverride: null,
  puzzleId: id,
  puzzle,
})

/** A standalone puzzle as `loadRenderablePuzzle` assembles it. */
function standalone(puzzle: PuzzleContent, slug: string, withKey = true): RenderableTest {
  return {
    test: makeTest({
      id: 'puzzle-x',
      title: puzzle.title,
      description: puzzleInstructions(puzzle),
      graded: false,
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      variants: 1,
    }),
    template: makeTemplate(slug),
    items: [puzzleItem(puzzle)],
    variant: 'A',
    withKey,
    assets: {},
  }
}

function inTest(puzzle: PuzzleContent, slug: string, variant: 'A' | 'B' = 'A'): RenderableTest {
  return {
    test: makeTest(),
    template: makeTemplate(slug),
    items: [...makeItems().slice(0, 3), puzzleItem(puzzle)],
    variant,
    withKey: true,
    assets: {},
  }
}

interface Glyph {
  str: string
  x: number
  /** Baseline measured from the top edge of the page. */
  y: number
}

async function pagesOf(buffer: Buffer, pageHeight = 842): Promise<Glyph[][]> {
  const pdfjs = await import('pdfjs-dist')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise
  const pages: Glyph[][] = []
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const glyphs: Glyph[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      // pdf.js returns uppercase letters with a caron decomposed (E + caron).
      glyphs.push({ str: item.str.normalize('NFC'), x: item.transform[4] as number, y: pageHeight - (item.transform[5] as number) })
    }
    pages.push(glyphs)
  }
  await doc.cleanup()
  return pages
}

/** Lines of a page: texts with the same baseline joined in sequence. */
function lines(page: Glyph[]): string[] {
  const byY = new Map<number, Glyph[]>()
  for (const glyph of page) {
    const y = Math.round(glyph.y)
    byY.set(y, [...(byY.get(y) ?? []), glyph])
  }
  return [...byY.values()].map((row) =>
    row
      .sort((a, b) => a.x - b.x)
      .map((g) => g.str)
      .join(''),
  )
}

/** Case-insensitive edit distance of at most a third of the length. */
function nearlyEqual(a: string, b: string): boolean {
  const x = [...a.trim().toLowerCase()]
  const y = [...b.trim().toLowerCase()]
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= y.length; j += 1) {
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return (previous[y.length] as number) <= y.length / 3
}

const pageText = (page: Glyph[]) => page.map((g) => g.str).join(' ')

async function renderPages(renderable: RenderableTest): Promise<Glyph[][]> {
  return pagesOf(await renderToBuffer(createElement(TestDocument, renderable) as never))
}

/** Question pages (without the key). */
function testPages(pages: Glyph[][]): Glyph[][] {
  const key = pages.findIndex((page) => page.some((g) => g.str.startsWith('Klíč')))
  return key === -1 ? pages : pages.slice(0, key)
}

/**
 * Real puzzle height: rendered on tall paper (so it does not break) followed
 * by a marker; the height is the marker position below the top edge.
 */
async function renderedHeight(puzzle: PuzzleContent, slug: string): Promise<number> {
  const config = makeTemplate(slug).config
  const height = 4000
  const padding = pagePadding(config)
  const buffer = await renderToBuffer(
    createElement(
      Document,
      null,
      createElement(
        Page,
        {
          size: [595.28, height],
          style: {
            ...padding,
            fontFamily: config.page.fontFamily,
            fontSize: config.page.fontSize,
            lineHeight: config.page.lineHeight,
          },
        },
        createElement(PuzzleView, { puzzle, config, showTitle: true, showInstructions: true, keepTogether: false }),
        createElement(Text, { style: { fontSize: 2, lineHeight: 1 } }, 'ZZKONECZZ'),
      ),
    ) as never,
  )
  const [page] = await pagesOf(buffer, height)
  const marker = page!.find((g) => g.str.includes('ZZKONECZZ'))!
  // The baseline of a two-point font lies about 1.6 pt below the top edge of the marker.
  return marker.y - 1.6 - padding.paddingTop
}

describe('printing a puzzle across pages', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn')
  })
  afterEach(() => {
    warn.mockRestore()
  })

  const cases: [string, () => RenderableTest][] = TEMPLATES.flatMap((slug) => [
    [`${slug}: osmisměrka 20×20 s nápovědami v písemce`, () => inTest(WS20_CLUES, slug)],
    [`${slug}: tajenka s dlouhou větou v písemce`, () => inTest(CRYPTO_LONG, slug)],
    [`${slug}: samostatná osmisměrka 20×20 s nápovědami`, () => standalone(WS20_CLUES, slug)],
    [`${slug}: samostatná osmisměrka 20×20 s klíčem`, () => standalone(WS20, slug)],
    [`${slug}: samostatná tajenka s dlouhou větou`, () => standalone(CRYPTO_LONG, slug)],
  ] as [string, () => RenderableTest][])

  it.each(cases)('%s does not fall apart', async (_, make) => {
    const renderable = make()
    const pages = await renderPages(renderable)
    const config = renderable.template.config
    const bottom = 842 - mm(config.page.marginBottomMm)

    // React-pdf warns when an unbreakable block has nowhere to go — and then squashes it.
    expect(warn.mock.calls.flat().join(' ')).not.toContain("can't wrap")
    for (const page of pages) {
      // The footer („strana X / Y" with the title next to it) sits in the bottom
      // margin on purpose; it is recognised by the page number line.
      const footerY = page.find((g) => /strana \d+ \/ \d+/.test(g.str))?.y
      const body = footerY === undefined ? page : page.filter((g) => Math.abs(g.y - footerY) > 2)
      // No text below the bottom margin (a squashed block overflowed the paper).
      expect(Math.max(...body.map((g) => g.y))).toBeLessThan(bottom + 1)
      // No empty page.
      expect(page.length).toBeGreaterThan(0)
    }
    // The preview paginates the same as the PDF.
    const heading = { title: renderable.test.title, description: renderable.test.description }
    expect(paginate(renderable.items, config, heading)).toHaveLength(testPages(pages).length)
  })

  it('the grid never splits: all word search rows are on one page', async () => {
    for (const slug of TEMPLATES) {
      const pages = testPages(await renderPages(inTest(WS20_CLUES, slug)))
      const built = buildPuzzle(WS20_CLUES)
      if (built.kind !== 'wordsearch') throw new Error('čekala se osmisměrka')
      // The last grid row as text by cells; it must lie on the same page as the first.
      const firstRow = built.wordSearch.grid[0]!.join('')
      const lastRow = built.wordSearch.grid[19]!.join('')
      const pageWith = (row: string) =>
        pages.findIndex((page) => page.map((g) => g.str.trim()).join('').includes(row))
      expect(pageWith(firstRow), slug).toBeGreaterThanOrEqual(0)
      expect(pageWith(lastRow), slug).toBe(pageWith(firstRow))
    }
  })
})

describe('standalone puzzle', () => {
  it('title and instructions appear only once on paper and the first page carries the puzzle', async () => {
    for (const slug of TEMPLATES) {
      for (const puzzle of [WS20_CLUES, CRYPTO_LONG, WS20]) {
        const pages = testPages(await renderPages(standalone(puzzle, slug, false)))
        // The title is bold and the bold font sometimes loses letters (a
        // separate font bug), so we look for a line that differs from the title
        // in at most a third of its characters. The compact template prints
        // the title in capitals.
        const titles = pages.flatMap(lines).filter((line) => nearlyEqual(line, puzzle.title))
        expect(titles, `${slug} ${puzzle.title}`).toHaveLength(1)
        const all = pages.map(pageText).join(' ').toLowerCase()
        expect(all.split('najdi v mřížce').length + all.split('doplň slova').length - 2).toBe(1)
        // The first page is not just the header: it has the grid or the cryptogram boxes.
        const built = buildPuzzle(puzzle)
        const marker = built.kind === 'wordsearch' ? built.wordSearch.grid[0]!.join('') : 'Doplňovačka'
        expect(pages[0]!.map((g) => g.str.trim()).join(''), `${slug} ${puzzle.title}`).toContain(marker)
      }
    }
  })

  it('the key of a standalone puzzle does not mention a variant', async () => {
    const pages = await renderPages(standalone(CRYPTO, 'klasicka'))
    const all = pages.map(pageText).join(' ')
    expect(all).toContain('Klíč')
    expect(all).not.toContain('varianta')
  })

  it('the key of a test still mentions the variant', async () => {
    const pages = await renderPages(inTest(CRYPTO, 'klasicka'))
    expect(pages.map(pageText).join(' ')).toContain('(varianta A)')
  })
})

describe('puzzle height estimate', () => {
  // Real height from the rendered PDF; the estimate may be slightly higher
  // (margin), not lower — an underestimate would show fewer pages in the
  // preview than the print.
  const cases: [string, PuzzleContent][] = [
    ['osmisměrka 20×20 s nápovědami', WS20_CLUES],
    ['osmisměrka 20×20', WS20],
    ['osmisměrka 14×14', wordsearch({ size: 14, n: 12 })],
    ['přeplněná osmisměrka 12×12', wordsearch({ size: 12, n: 40 })],
    ['tajenka se 14 řádky', CRYPTO],
    ['tajenka s dlouhou větou', CRYPTO_LONG],
  ]
  for (const slug of TEMPLATES) {
    it.each(cases)(`${slug}: %s matches the PDF within 10 %%`, async (_, puzzle) => {
      const real = await renderedHeight(puzzle, slug)
      const estimate = estimateHeight(puzzleItem(puzzle), makeTemplate(slug).config)
      expect(estimate).toBeGreaterThanOrEqual(real)
      expect(estimate).toBeLessThanOrEqual(real * 1.1)
    })
  }

  it('a puzzle taller than a page breaks onto the next page in the estimate instead of moving whole', () => {
    const config = makeTemplate('klasicka').config
    expect(estimateHeight(puzzleItem(CRYPTO_LONG), config)).toBeGreaterThan(usablePageHeight(config))
    const pages = paginate([puzzleItem(CRYPTO_LONG), ...makeItems().slice(1, 2)], config)
    // The puzzle starts on the first page; its rest and the question after it are on the second.
    expect(pages).toHaveLength(2)
    expect(pages[0]!.map((i) => i.id)).toEqual(['pz'])
  })
})

describe('what ends up on paper', () => {
  it('a word that did not fit the grid is not in the pupil list, but is in the key', async () => {
    const puzzle = wordsearch({ size: 12, n: 40, title: 'Přeplněná osmisměrka' })
    const built = buildPuzzle(puzzle)
    if (built.kind !== 'wordsearch') throw new Error('čekala se osmisměrka')
    expect(built.wordSearch.unplaced.length).toBeGreaterThan(0)

    const pages = await renderPages(standalone(puzzle, 'klasicka'))
    const pupil = testPages(pages).map(pageText).join(' ')
    const key = pages.slice(testPages(pages).length).map(pageText).join(' ')
    for (const word of built.wordSearch.unplaced) {
      expect(pupil).not.toContain(word.toUpperCase())
      expect(key).toContain(`${word}: v mřížce není`)
    }
    for (const placement of built.wordSearch.placements) expect(pupil).toContain(placement.word.toUpperCase())
  })

  it('a cryptogram with missing rows has those phrase letters pre-filled and row numbers match the phrase', async () => {
    const built = buildPuzzle(CRYPTO_MISSING)
    if (built.kind !== 'cryptogram') throw new Error('čekala se tajenka')
    const numbers = built.cryptogram.rows.map((row) => row.number)
    const missing = [...Array(built.cryptogram.phraseWords.flat().length).keys()]
      .map((i) => i + 1)
      .filter((n) => !numbers.includes(n))
    expect(missing.length).toBeGreaterThan(0)

    const pupil = testPages(await renderPages(standalone(CRYPTO_MISSING, 'klasicka', false)))
    const text = pupil.map(pageText).join(' ')
    const letters = built.cryptogram.phraseWords.flat()
    // Only letters without a row are pre-filled; other boxes are empty.
    const filled = pupil.flat().filter((g) => g.str.trim().length === 1 && /\p{Lu}/u.test(g.str))
    expect(filled.map((g) => g.str).sort()).toEqual(missing.map((n) => letters[n - 1]!).sort())
    for (const n of missing) expect(text).not.toMatch(new RegExp(`(^|\\s)${n}\\.(\\s|$)`))
  })

  it('cryptogram boxes are big enough for children and the widest row fits the page', () => {
    const built = buildPuzzle(CRYPTO_LONG)
    if (built.kind !== 'cryptogram') throw new Error('čekala se tajenka')
    const { boxSize, widthInBoxes } = cryptogramLayout(built.cryptogram)
    expect(boxSize).toBeGreaterThanOrEqual(18)
    expect(widthInBoxes * boxSize + CRYPTOGRAM_NUMBER_WIDTH).toBeLessThanOrEqual(PUZZLE_USABLE_WIDTH)
  })

  it('a very long word shrinks the boxes so the row fits the page', async () => {
    const long = puzzleContentSchema.parse({
      kind: 'cryptogram',
      title: 'Dlouhá slova',
      entries: [
        { word: 'mezižeberníprůdušinky', clue: 'Vymyšlené dlouhé slovo.' },
        { word: 'průdušinkymezižeberní', clue: 'Jiné vymyšlené dlouhé slovo.' },
      ],
      payload: { phrase: 'MP', seed: 'x' },
    })
    const built = buildPuzzle(long)
    if (built.kind !== 'cryptogram') throw new Error('čekala se tajenka')
    const { boxSize, widthInBoxes } = cryptogramLayout(built.cryptogram)
    expect(widthInBoxes * boxSize + CRYPTOGRAM_NUMBER_WIDTH).toBeLessThanOrEqual(PUZZLE_USABLE_WIDTH)
    for (const slug of TEMPLATES) {
      const config = makeTemplate(slug).config
      const right = 595.28 - mm(config.page.marginRightMm)
      const pages = await renderPages(standalone(long, slug))
      for (const page of pages) expect(Math.max(...page.map((g) => g.x))).toBeLessThan(right)
    }
  })
})

describe('variant B', () => {
  it('word search and cryptogram come out different from variant A, but just as good', () => {
    for (const puzzle of [wordsearch({ size: 14, n: 12 }), CRYPTO]) {
      const other = puzzleForVariant(puzzle, 'B')
      expect(other.payload.seed).not.toBe(puzzle.payload.seed)
      const a = buildPuzzle(puzzle)
      const b = buildPuzzle(other)
      expect(JSON.stringify(b)).not.toBe(JSON.stringify(a))
      expect(puzzleForVariant(puzzle, 'A')).toBe(puzzle)
    }
  })

  it('when another seed would turn out worse, variant A stays', () => {
    // An overcrowded grid: with another seed fewer words may fit.
    for (const seed of ['1', '2', '3', '4', '5', '6', '7', '8']) {
      const puzzle = puzzleContentSchema.parse({
        kind: 'wordsearch',
        title: 'Přeplněná',
        entries: entries(40),
        payload: { cols: 8, rows: 8, seed },
      })
      const other = puzzleForVariant(puzzle, 'B')
      const problems = (p: PuzzleContent) => {
        const built = buildPuzzle(p)
        return built.kind === 'wordsearch' ? built.wordSearch.problems.length : 0
      }
      expect(problems(other)).toBeLessThanOrEqual(problems(puzzle))
    }
  })

  it('the variant B PDF prints a different grid and its key', async () => {
    const puzzle = wordsearch({ size: 14, n: 12 })
    const gridOf = (p: PuzzleContent) => {
      const built = buildPuzzle(p)
      return built.kind === 'wordsearch' ? built.wordSearch.grid[0]!.join('') : ''
    }
    const text = (await renderPages(inTest(puzzle, 'klasicka', 'B')))
      .map((page) => page.map((g) => g.str.trim()).join(''))
      .join('')
    expect(text).toContain(gridOf(puzzleForVariant(puzzle, 'B')))
    expect(text).not.toContain(gridOf(puzzle))
  })
})
