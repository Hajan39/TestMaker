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

describe('fill-in table', () => {
  it('passes when valid', () => {
    expect(tableItemContentSchema.safeParse(table).success).toBe(true)
  })

  it('a row with a different cell count than columns fails', () => {
    const broken = { ...table, rows: [[{ value: 'Plíce', blank: true }]] }
    expect(tableItemContentSchema.safeParse(broken).success).toBe(false)
  })

  it('a table without an empty cell fails — there would be nothing to fill in', () => {
    const full = { ...table, rows: [[{ value: 'Plíce', blank: false }, { value: 'x', blank: false }]] }
    expect(tableItemContentSchema.safeParse(full).success).toBe(false)
  })

  it('more than 6 columns or 12 rows fails', () => {
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
  it('broken table content returns null instead of throwing', () => {
    expect(parseItemContent('table', { header: ['A'], rows: [[]] })).toBeNull()
    expect(parseItemContent('table', 'nesmysl')).toBeNull()
    expect(parseItemContent('table', null)).toBeNull()
  })

  it('valid content is returned in schema shape', () => {
    expect(parseItemContent('table', table)).toEqual(table)
    expect(parseItemContent('text', { variant: 'fun_fact' })).toEqual({ variant: 'fun_fact' })
    expect(textItemContentSchema.safeParse({ variant: 'esej' }).success).toBe(false)
  })
})

describe('worksheet brief', () => {
  it('reads stored JSON as well as old plain text', () => {
    expect(parseWorksheetBrief(JSON.stringify({ title: 'Sopky', instructions: 'víc tabulek', ownText: '' }))).toEqual({
      title: 'Sopky',
      instructions: 'víc tabulek',
      ownText: '',
      onlyMaterials: true,
    })
    expect(parseWorksheetBrief('jen pokyn')).toEqual({ title: '', instructions: 'jen pokyn', ownText: '', onlyMaterials: true })
    expect(parseWorksheetBrief(null)).toBeNull()
  })
})

describe('fun fact box in the template', () => {
  it('has a default look, so existing templates work unchanged', () => {
    expect(templateConfigSchema.parse({}).funFact).toEqual({ label: 'Věděli jste?', border: true, shaded: true })
    for (const template of BUILT_IN_TEMPLATES) {
      expect(templateConfigSchema.parse(template.config).funFact.label).toBe('Věděli jste?')
    }
  })
})
