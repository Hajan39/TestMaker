/**
 * Word export. The document is read back with the app's own DOCX extractor
 * (the one that reads teachers' materials), so the test fails when the file
 * stops being a readable Word document, not just when a string changes.
 */
import JSZip from 'jszip'
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'
import { renderTestToDocx } from '../src/docx'
import { extractDocx } from '../src/extract/docx'
import { printedItems } from '../src/pdf/layout'
import { BUILT_IN_TEMPLATES } from '../src/schema/builtInTemplates'
import { puzzleContentSchema } from '../src/schema/puzzle'
import type { RenderableTest, ResolvedTestItem } from '../src/schema/test'
import { makeItems, makeQuestion, makeTemplate, makeTest, makeWorksheetItems, TALL_IMAGE_DATA_URL } from './fixtures'

beforeAll(() => {
  globalThis.DOMParser = new JSDOM().window.DOMParser
})

const render = (overrides: Partial<RenderableTest> = {}) =>
  renderTestToDocx({
    test: makeTest(),
    template: makeTemplate(),
    items: makeItems(),
    variant: 'A',
    withKey: false,
    assets: {},
    ...overrides,
  })

const textOf = async (buffer: Buffer) => (await extractDocx(buffer)).text

const item = (overrides: Partial<ResolvedTestItem>): ResolvedTestItem => ({
  id: 'item-x',
  testId: 'test-1',
  order: 0,
  kind: 'question',
  questionId: null,
  text: null,
  pointsOverride: null,
  ...overrides,
})

const ENTRIES = [
  { word: 'hrtan', clue: 'Chrupavčitý orgán s hlasivkami.' },
  { word: 'plíce', clue: 'Párový orgán, ve kterém probíhá výměna plynů.' },
  { word: 'žebra', clue: 'Kosti chránící hrudník.' },
  { word: 'nos', clue: 'Tudy se nadechujeme.' },
]

describe('Word export', () => {
  it('writes the test as text: title, header fields, prompts, options and tables', async () => {
    const text = await textOf(await render())
    expect(text).toContain('Dýchací soustava A')
    expect(text).toContain('Část A – Stavba dýchací soustavy')
    expect(text).toContain('1. Kde probíhá výměna plynů v plicích? (1 b.)')
    expect(text).toContain('B) V plicních sklípcích')
    expect(text).toContain('Tvrzení | ANO | NE')
    expect(text).toContain('Vzduch vstupuje do těla (1) ______________ a pokračuje do (2) ______________.')
    expect(text).toContain('Nabídka: dutinou nosní • hrtanu • žaludkem')
    expect(text).toContain('Hrtan | (1)')
    expect(text).toContain('Odpověď:')
  })

  it('is the blank pupil version even when the filled copy is asked for', async () => {
    const text = await textOf(await render({ filled: true, withKey: true }))
    expect(text).not.toContain('nosohltan → hrtan')
    expect(text).not.toContain('tvorba hlasu')
    expect(text).not.toContain('Klíč')
  })

  it('gives an open question as many ruled lines as the test item asks for', async () => {
    const question = makeQuestion({ type: 'open', payload: { prompt: 'Popiš dýchání.', lines: 4, answer: 'x' } })
    const ruledLines = async (linesOverride: number | null) => {
      const zip = await JSZip.loadAsync(await render({ items: [item({ question, linesOverride })] }))
      const xml = await zip.file('word/document.xml')!.async('string')
      return xml.match(/<w:tcBorders><w:bottom [^>]*><\/w:tcBorders>/g)?.length
    }
    expect(await ruledLines(null)).toBe(4)
    expect(await ruledLines(7)).toBe(7)
  })

  it('leaves points out of an ungraded test', async () => {
    const text = await textOf(await render({ test: makeTest({ graded: false }) }))
    expect(text).toContain('1. Kde probíhá výměna plynů v plicích?')
    expect(text).not.toContain('b.)')
    expect(text).not.toContain('Známka')
  })

  it('prints variant B in the same order as the PDF does', async () => {
    const text = await textOf(await render({ variant: 'B' }))
    expect(text).toContain('Dýchací soustava B')
    const questions = printedItems(makeItems(), 'B', makeTest()).filter((entry) => entry.kind === 'question')
    const prompts = questions.map((entry) => (entry.question!.payload as { prompt: string }).prompt)
    expect(prompts[0]).not.toBe('Kde probíhá výměna plynů v plicích?')
    prompts.forEach((prompt, i) => expect(text).toContain(`${i + 1}. ${prompt}`))
  })

  it('every part of the package is well-formed XML, for every built-in template', async () => {
    for (const { slug } of BUILT_IN_TEMPLATES) {
      const zip = await JSZip.loadAsync(await render({ template: makeTemplate(slug), items: [...makeItems(), ...makeWorksheetItems()] }))
      const parts = Object.keys(zip.files).filter((name) => /\.(xml|rels)$/.test(name))
      expect(parts, slug).toEqual(
        expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']),
      )
      for (const name of parts) {
        const xml = await zip.file(name)!.async('string')
        const errors = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror')
        expect(errors.length, `${slug}: ${name}`).toBe(0)
      }
    }
  })

  it('keeps text that would break XML, and drops control characters it cannot carry', async () => {
    const question = makeQuestion({
      type: 'short_answer',
      payload: { prompt: 'Platí 3 < 5 & 5 > 3?\u0007 "ano"', answer: 'ano', acceptedAnswers: [] },
    })
    const text = await textOf(await render({ items: makeItems([question]) }))
    expect(text).toContain('Platí 3 < 5 & 5 > 3? "ano"')
  })

  it('embeds an image scaled down to the height cap', async () => {
    const question = makeQuestion({
      type: 'short_answer',
      payload: { prompt: 'Co je na obrázku?', answer: 'plíce', acceptedAnswers: [] },
      blocks: [{ kind: 'image', assetId: 'a1', widthPercent: 100 }],
    })
    const zip = await JSZip.loadAsync(await render({ items: makeItems([question]), assets: { a1: TALL_IMAGE_DATA_URL } }))
    const stored = await zip.file('word/media/image1.png')!.async('base64')
    expect(stored).toBe(TALL_IMAGE_DATA_URL.split(',')[1])
    const xml = await zip.file('word/document.xml')!.async('string')
    // 400 × 3200 px capped at 260 pt of height keeps its 1 : 8 ratio (12 700 EMU per point).
    expect(xml).toContain('<wp:extent cx="412750" cy="3302000"/>')
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('Target="media/image1.png"')
  })

  it('says so on the page when an image is missing', async () => {
    const question = makeQuestion({
      type: 'label_image',
      payload: { prompt: 'Popiš obrázek.', assetId: 'gone', labels: ['hrtan', 'plíce'] },
    })
    const buffer = await render({ items: makeItems([question]) })
    expect(await textOf(buffer)).toContain('[Obrázek se nepodařilo načíst]')
    expect(Object.keys((await JSZip.loadAsync(buffer)).files).filter((name) => name.startsWith('word/media/'))).toEqual([])
  })

  it('writes worksheet text, the fun fact and a table with empty cells to fill in', async () => {
    const text = await textOf(await render({ template: makeTemplate('pracovni-list'), items: makeWorksheetItems() }))
    expect(text).toContain('Plíce jsou párový orgán uložený v hrudníku.')
    expect(text).toContain('Věděli jste?')
    expect(text).toContain('Orgán | Funkce | Kde leží')
    expect(text).toContain('Orgán 1 | | v těle 1')
    expect(text).not.toContain('funkce 1')
  })

  it('draws a word search as a grid with the list of words under it', async () => {
    const puzzle = puzzleContentSchema.parse({
      kind: 'wordsearch',
      title: 'Osmisměrka',
      entries: ENTRIES,
      payload: { cols: 8, rows: 6, seed: 'docx' },
    })
    const buffer = await render({ items: [item({ kind: 'puzzle', puzzle })] })
    const text = await textOf(buffer)
    expect(text).toContain('Osmisměrka')
    expect(text).toContain('HRTAN | PLÍCE | ŽEBRA')
    const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string')
    // 6 grid rows of 8 letter boxes + 2 rows of the word list.
    expect(xml.match(/<w:tr>/g)).toHaveLength(8)
    expect(xml.match(/<w:tcBorders>/g)).toHaveLength(48)
  })

  it('draws a cryptogram with empty boxes, one marked box per row and the clues', async () => {
    const puzzle = puzzleContentSchema.parse({
      kind: 'cryptogram',
      title: 'Tajenka',
      entries: ENTRIES,
      // Each letter has its own word: pLíce, žEbra, hrtaN / Nos.
      payload: { phrase: 'len', seed: 'docx' },
    })
    const buffer = await render({ items: [item({ kind: 'puzzle', puzzle })] })
    const text = await textOf(buffer)
    expect(text).toContain('Tajenka:')
    expect(text).toContain('Doplňovačka:')
    expect(text).toContain('1. Párový orgán, ve kterém probíhá výměna plynů.')
    // The solution must not be on the pupils' paper.
    expect(text).not.toMatch(/L \| E \| N/i)
    expect(text).not.toMatch(/P \| L \| Í \| C \| E/i)
    const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string')
    // Three rows, one thick-framed box (four edges) in each.
    expect(xml.match(/w:sz="12" w:space="0" w:color="111111"/g)).toHaveLength(3 * 4)
  })
})
