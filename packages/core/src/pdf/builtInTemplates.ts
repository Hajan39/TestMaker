import { templateConfigSchema, type TemplateConfig } from '../schema/template.js'

const STANDARD_FIELDS = [
  { key: 'name', label: 'Jméno a příjmení', widthPercent: 60, value: '' },
  { key: 'class', label: 'Třída', widthPercent: 40, value: '' },
  { key: 'date', label: 'Datum', widthPercent: 40, value: '' },
]

export interface BuiltInTemplate {
  slug: string
  name: string
  description: string
  config: TemplateConfig
}

/** Vestavěné šablony se při migraci nasypou do tabulky `templates`. */
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
  {
    slug: 'pracovni-list',
    name: 'Pracovní list',
    description: 'Vzdušný layout, otázky v rámečcích, více místa na odpovědi. Bez bodování.',
    config: templateConfigSchema.parse({
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
