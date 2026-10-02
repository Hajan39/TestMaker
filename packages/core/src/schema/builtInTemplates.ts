import { templateConfigSchema, type TemplateConfig, type TemplateTheme } from './template'

const STANDARD_FIELDS = [
  { key: 'name', label: 'Jméno a příjmení', widthPercent: 60, value: '' },
  { key: 'class', label: 'Třída', widthPercent: 40, value: '' },
  { key: 'date', label: 'Datum', widthPercent: 40, value: '' },
]

/**
 * A playful worksheet: roomy layout, coloured section bands, numbers in
 * circles and a decoration in the margins. Only colours, shapes and the fun
 * fact label differ between them.
 */
function playfulWorksheet(input: {
  slug: string
  name: string
  description: string
  theme: Pick<TemplateTheme, 'accent' | 'accentSoft' | 'border' | 'radius' | 'decoration'>
  funFactLabel: string
}): BuiltInTemplate {
  return {
    slug: input.slug,
    name: input.name,
    description: input.description,
    config: templateConfigSchema.parse({
      kind: 'pracovni_list',
      theme: { ...input.theme, sectionBanner: true, numberBadge: true },
      page: { fontSize: 11.5, lineHeight: 1.5, marginTopMm: 18, marginBottomMm: 18, marginLeftMm: 18, marginRightMm: 18 },
      header: {
        show: true,
        title: { show: true, fontSize: 20, align: 'center', uppercase: false },
        fields: [
          { key: 'name', label: 'Jméno', widthPercent: 60, value: '' },
          { key: 'class', label: 'Třída', widthPercent: 40, value: '' },
        ],
        scoreBox: false,
        rule: false,
      },
      numbering: 'decimal',
      showPoints: false,
      footer: true,
      sectionStyle: { fontSize: 13, rule: false, spacingBefore: 18 },
      funFact: { label: input.funFactLabel, border: true, shaded: true },
      questionDefaults: { spacingBefore: 12, optionColumns: 1, answerLineHeight: 24, boxed: true },
      questionStyles: { true_false: { boxed: false }, table_fill: { boxed: false } },
    }),
  }
}

export interface BuiltInTemplate {
  slug: string
  name: string
  description: string
  config: TemplateConfig
}

/**
 * Built-in templates are seeded into the `templates` table on migration.
 * Their names, descriptions and field labels are stored data, not UI texts.
 */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    slug: 'klasicka',
    name: 'Klasická',
    description: 'Hlavička s linkami, číslované otázky v jednom sloupci. Univerzální písemka.',
    config: templateConfigSchema.parse({
      page: { fontSize: 10.5, marginTopMm: 15, marginBottomMm: 15, marginLeftMm: 18, marginRightMm: 15 },
      header: {
        show: true,
        title: { show: true, fontSize: 16, align: 'center', uppercase: false },
        fields: STANDARD_FIELDS,
        scoreBox: true,
        rule: true,
      },
      numbering: 'decimal-dot',
      showPoints: true,
      footer: true,
      sectionStyle: { fontSize: 12, rule: true, spacingBefore: 16 },
      questionDefaults: { spacingBefore: 10, optionColumns: 1, answerLineHeight: 20, boxed: false },
      questionStyles: {},
    }),
  },
  {
    slug: 'kompaktni',
    name: 'Kompaktní',
    description: 'Menší písmo, možnosti ve dvou sloupcích, užší řádkování. Šetří papír.',
    config: templateConfigSchema.parse({
      page: {
        fontSize: 9,
        lineHeight: 1.25,
        marginTopMm: 12,
        marginBottomMm: 12,
        marginLeftMm: 14,
        marginRightMm: 12,
      },
      header: {
        show: true,
        title: { show: true, fontSize: 13, align: 'left', uppercase: true },
        fields: STANDARD_FIELDS,
        scoreBox: true,
        rule: true,
      },
      numbering: 'decimal-dot',
      showPoints: true,
      footer: true,
      sectionStyle: { fontSize: 10, uppercase: true, rule: false, spacingBefore: 12 },
      questionDefaults: { spacingBefore: 7, optionColumns: 2, answerLineHeight: 16, boxed: false },
      questionStyles: { open: { answerLineHeight: 18 }, matching: { spacingBefore: 9 } },
    }),
  },
  playfulWorksheet({
    slug: 'list-slunicko',
    name: 'Sluníčko',
    description: 'Hravý pracovní list v oranžové: barevné nadpisy, čísla v kolečkách, puntíky v rozích.',
    theme: { accent: '#e8590c', accentSoft: '#ffe8cc', border: '#f8a967', radius: 8, decoration: 'dots' },
    funFactLabel: 'Věděli jste?',
  }),
  playfulWorksheet({
    slug: 'list-louka',
    name: 'Louka',
    description: 'Zelený pracovní list s vlnkami nahoře i dole, oblé rámečky a barevné nadpisy částí.',
    theme: { accent: '#2b8a3e', accentSoft: '#d3f9d8', border: '#8ce99a', radius: 10, decoration: 'waves' },
    funFactLabel: 'Zajímavost',
  }),
  playfulWorksheet({
    slug: 'list-vesmir',
    name: 'Vesmír',
    description: 'Fialový pracovní list s hvězdičkami v rozích — pro badatele a průzkumníky.',
    theme: { accent: '#6741d9', accentSoft: '#e5dbff', border: '#b197fc', radius: 6, decoration: 'stars' },
    funFactLabel: 'Víš, že…?',
  }),
  {
    slug: 'pracovni-list',
    name: 'Pracovní list – jednoduchý',
    description: 'Vzdušný černobílý layout, otázky v rámečcích, více místa na odpovědi. Bez bodování.',
    config: templateConfigSchema.parse({
      kind: 'pracovni_list',
      page: {
        fontSize: 11,
        lineHeight: 1.5,
        marginTopMm: 16,
        marginBottomMm: 16,
        marginLeftMm: 18,
        marginRightMm: 18,
      },
      header: {
        show: true,
        title: { show: true, fontSize: 18, align: 'center', uppercase: false },
        fields: [
          { key: 'name', label: 'Jméno', widthPercent: 60, value: '' },
          { key: 'class', label: 'Třída', widthPercent: 40, value: '' },
        ],
        scoreBox: false,
        rule: false,
      },
      numbering: 'paren',
      showPoints: false,
      footer: true,
      sectionStyle: { fontSize: 13, rule: true, spacingBefore: 20 },
      questionDefaults: { spacingBefore: 12, optionColumns: 1, answerLineHeight: 24, boxed: true },
      questionStyles: { true_false: { boxed: false }, table_fill: { boxed: false } },
    }),
  },
]
