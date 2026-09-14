import { z } from 'zod'
import { QUESTION_TYPES } from './question.js'

/**
 * Šablona je data, ne komponenta. PDF renderer je jeden generický a řídí se tímto JSON.
 * Editor šablon (pozdější fáze) tedy edituje jen tuto strukturu.
 */

export const headerFieldSchema = z.object({
  /** Klíč pole, např. `name`, `class`, `date`, `school`, `subject`. */
  key: z.string().min(1),
  label: z.string().min(1),
  /** Šířka v procentech řádku hlavičky. */
  widthPercent: z.number().int().min(10).max(100).default(50),
  /** Předvyplněná hodnota (škola, předmět). Prázdné = linka pro žáka. */
  value: z.string().default(''),
})

export const pageStyleSchema = z.object({
  marginTopMm: z.number().min(5).max(40).default(15),
  marginBottomMm: z.number().min(5).max(40).default(15),
  marginLeftMm: z.number().min(5).max(40).default(18),
  marginRightMm: z.number().min(5).max(40).default(15),
  fontFamily: z.enum(['NotoSans', 'NotoSerif']).default('NotoSans'),
  fontSize: z.number().min(7).max(16).default(10.5),
  lineHeight: z.number().min(1).max(2.5).default(1.4),
})

export const headerStyleSchema = z.object({
  show: z.boolean().default(true),
  title: z.object({
    show: z.boolean().default(true),
    fontSize: z.number().min(9).max(28).default(16),
    align: z.enum(['left', 'center']).default('center'),
    uppercase: z.boolean().default(false),
  }),
  fields: z.array(headerFieldSchema).default([]),
  /** Políčko na body a známku — vykreslí se jen u testu na známky. */
  scoreBox: z.boolean().default(true),
  /** Vodorovná linka pod hlavičkou. */
  rule: z.boolean().default(true),
})

export const questionStyleSchema = z.object({
  /** Mezera nad otázkou v bodech. */
  spacingBefore: z.number().min(0).max(40).default(10),
  /** Možnosti u výběrových otázek ve dvou sloupcích. */
  optionColumns: z.union([z.literal(1), z.literal(2)]).default(1),
  /** Výška jedné linky na odpověď v bodech (typ `open`). */
  answerLineHeight: z.number().min(10).max(40).default(20),
  /** Rámeček kolem celé otázky. */
  boxed: z.boolean().default(false),
})

export const templateConfigSchema = z.object({
  page: pageStyleSchema.default({}),
  header: headerStyleSchema.default({}),
  /** Styl číslování otázek. */
  numbering: z.enum(['decimal', 'decimal-dot', 'paren', 'none']).default('decimal-dot'),
  /** Zobrazovat u otázky počet bodů (jen test na známky). */
  showPoints: z.boolean().default(true),
  /** Zápatí s číslem strany a variantou. */
  footer: z.boolean().default(true),
  sectionStyle: z.object({
    fontSize: z.number().min(8).max(20).default(12),
    uppercase: z.boolean().default(false),
    rule: z.boolean().default(true),
    spacingBefore: z.number().min(0).max(60).default(16),
  }).default({}),
  /** Výchozí styl otázky + přepisy pro konkrétní typy. */
  questionDefaults: questionStyleSchema.default({}),
  questionStyles: z.partialRecord(z.enum(QUESTION_TYPES), questionStyleSchema.partial()).default({}),
})

export type TemplateConfig = z.infer<typeof templateConfigSchema>
export type QuestionStyle = z.infer<typeof questionStyleSchema>
export type HeaderField = z.infer<typeof headerFieldSchema>

export interface Template {
  id: string
  name: string
  description: string | null
  config: TemplateConfig
  builtIn: boolean
}

/** Vrátí efektivní styl pro daný typ otázky (výchozí + přepis). */
export function resolveQuestionStyle(
  config: TemplateConfig,
  type: (typeof QUESTION_TYPES)[number],
): QuestionStyle {
  return { ...config.questionDefaults, ...(config.questionStyles[type] ?? {}) }
}
