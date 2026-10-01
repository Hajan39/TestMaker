import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { TestDocument } from '../src/pdf/TestDocument'
import { registerServerFonts } from '../src/pdf/node'
import { estimateHeight, paginate, tableParts, usablePageHeight } from '../src/pdf/estimate'
import { extractPdf } from '../src/extract/pdf'
import type { ResolvedTestItem } from '../src/schema/test'
import { makeTable, makeTemplate, makeTest, makeWorksheetItems } from './fixtures'

registerServerFonts()
const template = makeTemplate('pracovni-list')
const config = template.config

async function renderText(items: ResolvedTestItem[], withKey = true): Promise<string> {
  const buffer = await renderToBuffer(
    createElement(TestDocument, {
      test: makeTest({ graded: false, kind: 'pracovni_list', variants: 1 }),
      template,
      items,
      variant: 'A',
      withKey,
      assets: {},
    }) as never,
  )
  return (await extractPdf(new Uint8Array(buffer))).text
}

const tableItem = (rows: number, longCells = false): ResolvedTestItem => ({
  id: `tab-${rows}`,
  testId: 'list-1',
  order: 0,
  kind: 'table',
  questionId: null,
  text: null,
  pointsOverride: null,
  table: makeTable(rows, longCells),
})

describe('worksheet item height estimate', () => {
  const [, text, funFact] = makeWorksheetItems()

  it('a text takes space and grows with length', () => {
    const short = estimateHeight(text!, config)
    const long = estimateHeight({ ...text!, text: `${text!.text} `.repeat(8) }, config)
    expect(short).toBeGreaterThan(0)
    expect(long).toBeGreaterThan(short)
  })

  it('a boxed fun fact with a label is taller than the same text without a box', () => {
    expect(estimateHeight({ ...funFact!, text: text!.text }, config)).toBeGreaterThan(estimateHeight(text!, config))
  })

  it('a table grows with its row count', () => {
    expect(estimateHeight(tableItem(12), config)).toBeGreaterThan(estimateHeight(tableItem(2), config))
  })

  it('a table splits by rows: the first chunk carries caption, header and first row', () => {
    const parts = tableParts(tableItem(4), config)!
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBeGreaterThan(parts[1]!)
    expect(tableParts(makeWorksheetItems()[1]!, config)).toBeNull()
  })

  it('a broken table has no height and no chunks', () => {
    const broken = { ...tableItem(3), table: null }
    expect(estimateHeight(broken, config)).toBe(0)
    expect(tableParts(broken, config)).toBeNull()
  })

  it('a tall table overflows to the next page instead of moving down whole', () => {
    const tall = tableItem(12, true)
    const total = estimateHeight(tall, config)
    // Test precondition: the table is taller than half a page.
    expect(total).toBeGreaterThan(usablePageHeight(config) / 2)
    const pages = paginate([...makeWorksheetItems().slice(0, 3), tableItem(12, true), tall], config)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    // The first tall table starts on the first page right after the texts.
    expect(pages[0]!.map((item) => item.id)).toContain('tab-12')
  })
})

describe('worksheet printing', () => {
  it('prints text, a labelled fun fact and a table, with filled cells in the key', async () => {
    const text = await renderText(makeWorksheetItems())
    expect(text).toContain('Plíce jsou párový orgán')
    expect(text).toContain('Věděli jste?')
    expect(text).toContain('dvacettisíckrát')
    expect(text).toContain('Doplň tabulku orgánů')
    expect(text).toContain('Kde leží')
    // An empty cell is not printed in the questions, but is in the key.
    const withoutKey = await renderText(makeWorksheetItems(), false)
    expect(withoutKey).not.toContain('funkce 1')
    expect(text).toContain('funkce 1')
  })

  it('takes the fun fact label from the template', async () => {
    const custom = { ...template, config: { ...config, funFact: { ...config.funFact, label: 'Zajímavost' } } }
    const buffer = await renderToBuffer(
      createElement(TestDocument, {
        test: makeTest({ graded: false, kind: 'pracovni_list' }),
        template: custom,
        items: makeWorksheetItems(),
        variant: 'A',
        withKey: false,
        assets: {},
      }) as never,
    )
    const { text } = await extractPdf(new Uint8Array(buffer))
    expect(text).toContain('Zajímavost')
    expect(text).not.toContain('Věděli jste?')
  })

  it('a broken table is skipped and the rest of the worksheet prints', async () => {
    const items = makeWorksheetItems().map((item) => (item.kind === 'table' ? { ...item, table: null } : item))
    const text = await renderText(items)
    expect(text).toContain('Věděli jste?')
    expect(text).not.toContain('Kde leží')
  })
})
