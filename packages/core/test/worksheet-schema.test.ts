import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_TEMPLATES,
  parseItemContent,
  parseWorksheetBrief,
  tableItemContentSchema,
  templateConfigSchema,
  textItemContentSchema,
} from '../src/schema'

const table = {
  caption: 'Doplň tabulku',
  header: ['Orgán', 'Funkce'],
  rows: [
    [
      { value: 'Plíce', blank: false },
      { value: 'výměna plynů', blank: true },
    ],
  ],
}

describe('tabulka k doplnění', () => {
  it('projde v pořádku', () => {
    expect(tableItemContentSchema.safeParse(table).success).toBe(true)
  })

  it('řádek s jiným počtem buněk než sloupců neprojde', () => {
    const broken = { ...table, rows: [[{ value: 'Plíce', blank: true }]] }
    expect(tableItemContentSchema.safeParse(broken).success).toBe(false)
  })

  it('tabulka bez prázdné buňky neprojde — nebylo by co doplňovat', () => {
    const full = { ...table, rows: [[{ value: 'Plíce', blank: false }, { value: 'x', blank: false }]] }
    expect(tableItemContentSchema.safeParse(full).success).toBe(false)
  })

  it('víc než 6 sloupců nebo 12 řádků neprojde', () => {
    const wide = {
      header: Array.from({ length: 7 }, (_, i) => `S${i}`),
      rows: [Array.from({ length: 7 }, () => ({ value: '', blank: true }))],
    }
    const tall = {
      header: ['A'],
      rows: Array.from({ length: 13 }, () => [{ value: '', blank: true }]),
    }
    expect(tableItemContentSchema.safeParse(wide).success).toBe(false)
    expect(tableItemContentSchema.safeParse(tall).success).toBe(false)
  })
})

describe('parseItemContent', () => {
  it('poškozený obsah tabulky vrací null místo výjimky', () => {
    expect(parseItemContent('table', { header: ['A'], rows: [[]] })).toBeNull()
    expect(parseItemContent('table', 'nesmysl')).toBeNull()
    expect(parseItemContent('table', null)).toBeNull()
  })

  it('platný obsah vrací v podobě schématu', () => {
    expect(parseItemContent('table', table)).toEqual(table)
    expect(parseItemContent('text', { variant: 'fun_fact' })).toEqual({ variant: 'fun_fact' })
    expect(textItemContentSchema.safeParse({ variant: 'esej' }).success).toBe(false)
  })
})

describe('zadání listu', () => {
  it('čte uložené JSON i starý prostý text', () => {
    expect(parseWorksheetBrief(JSON.stringify({ title: 'Sopky', instructions: 'víc tabulek', ownText: '' }))).toEqual({
      title: 'Sopky',
      instructions: 'víc tabulek',
      ownText: '',
    })
    expect(parseWorksheetBrief('jen pokyn')).toEqual({ title: '', instructions: 'jen pokyn', ownText: '' })
    expect(parseWorksheetBrief(null)).toBeNull()
  })
})

describe('rámeček fun factu v šabloně', () => {
  it('má výchozí vzhled, takže stávající šablony fungují beze změny', () => {
    expect(templateConfigSchema.parse({}).funFact).toEqual({ label: 'Věděli jste?', border: true, shaded: true })
    for (const template of BUILT_IN_TEMPLATES) {
      expect(templateConfigSchema.parse(template.config).funFact.label).toBe('Věděli jste?')
    }
  })
})
