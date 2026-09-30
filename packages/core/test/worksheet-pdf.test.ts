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

describe('odhad výšky položek listu', () => {
  const [, text, funFact] = makeWorksheetItems()

  it('text zabere místo a s délkou roste', () => {
    const short = estimateHeight(text!, config)
    const long = estimateHeight({ ...text!, text: `${text!.text} `.repeat(8) }, config)
    expect(short).toBeGreaterThan(0)
    expect(long).toBeGreaterThan(short)
  })

  it('fun fact v rámečku s popiskem je vyšší než týž text bez rámečku', () => {
    expect(estimateHeight({ ...funFact!, text: text!.text }, config)).toBeGreaterThan(estimateHeight(text!, config))
  })

  it('tabulka roste s počtem řádků', () => {
    expect(estimateHeight(tableItem(12), config)).toBeGreaterThan(estimateHeight(tableItem(2), config))
  })

  it('tabulka se dělí po řádcích: první kus nese popisek, záhlaví i první řádek', () => {
    const parts = tableParts(tableItem(4), config)!
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBeGreaterThan(parts[1]!)
    expect(tableParts(makeWorksheetItems()[1]!, config)).toBeNull()
  })

  it('poškozená tabulka nemá výšku ani kusy', () => {
    const broken = { ...tableItem(3), table: null }
    expect(estimateHeight(broken, config)).toBe(0)
    expect(tableParts(broken, config)).toBeNull()
  })

  it('vysoká tabulka přeteče na další stranu, místo aby se celá odsunula', () => {
    const tall = tableItem(12, true)
    const total = estimateHeight(tall, config)
    // Předpoklad testu: tabulka je vyšší než polovina strany.
    expect(total).toBeGreaterThan(usablePageHeight(config) / 2)
    const pages = paginate([...makeWorksheetItems().slice(0, 3), tableItem(12, true), tall], config)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    // První vysoká tabulka začíná na první straně hned za texty.
    expect(pages[0]!.map((item) => item.id)).toContain('tab-12')
  })
})

describe('tisk pracovního listu', () => {
  it('vytiskne text, fun fact s popiskem i tabulku, v klíči s doplněnými buňkami', async () => {
    const text = await renderText(makeWorksheetItems())
    expect(text).toContain('Plíce jsou párový orgán')
    expect(text).toContain('Věděli jste?')
    expect(text).toContain('dvacettisíckrát')
    expect(text).toContain('Doplň tabulku orgánů')
    expect(text).toContain('Kde leží')
    // Prázdná buňka se v zadání nevytiskne, v klíči ano.
    const withoutKey = await renderText(makeWorksheetItems(), false)
    expect(withoutKey).not.toContain('funkce 1')
    expect(text).toContain('funkce 1')
  })

  it('popisek fun factu bere ze šablony', async () => {
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

  it('poškozená tabulka se vynechá a zbytek listu se vytiskne', async () => {
    const items = makeWorksheetItems().map((item) => (item.kind === 'table' ? { ...item, table: null } : item))
    const text = await renderText(items)
    expect(text).toContain('Věděli jste?')
    expect(text).not.toContain('Kde leží')
  })
})
