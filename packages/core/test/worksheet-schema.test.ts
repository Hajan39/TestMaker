import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_TEMPLATES,
  parseItemContent,
  parseWorksheetBrief,
  tableItemContentSchema,
  templateConfigSchema,
  templatesFor,
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
    // Templates without their own label (all but the playful worksheets) keep the default one.
    for (const template of BUILT_IN_TEMPLATES.filter((item) => !item.slug.startsWith('list-'))) {
      expect(templateConfigSchema.parse(template.config).funFact.label).toBe('Věděli jste?')
    }
  })
})

describe('template themes', () => {
  it('a template without a theme keeps the plain look of a written test', () => {
    const plain = templateConfigSchema.parse({})
    expect(plain.kind).toBe('pisemka')
    expect(plain.theme).toMatchObject({ accent: '#111111', accentSoft: '#f0f0f0', sectionBanner: false, numberBadge: false, decoration: 'none' })
  })

  it('there are at least three playful worksheet templates, each with its own colour and decoration', () => {
    const playful = BUILT_IN_TEMPLATES.filter((item) => item.config.kind === 'pracovni_list' && item.config.theme.numberBadge)
    expect(playful.length).toBeGreaterThanOrEqual(3)
    expect(new Set(playful.map((item) => item.config.theme.accent)).size).toBe(playful.length)
    expect(playful.every((item) => item.config.theme.decoration !== 'none')).toBe(true)
  })

  it('a worksheet is offered worksheet templates first, a test only test ones', () => {
    const templates = BUILT_IN_TEMPLATES.map((item) => ({ id: item.slug, config: item.config }))
    expect(templatesFor(templates, 'pracovni_list')[0]?.id).toBe('list-slunicko')
    expect(templatesFor(templates, 'pisemka').map((item) => item.id)).toEqual(['klasicka', 'kompaktni'])
    // An older worksheet printed with a test template keeps it on offer.
    expect(templatesFor(templates, 'pracovni_list', 'klasicka').map((item) => item.id)).toContain('klasicka')
  })
})

