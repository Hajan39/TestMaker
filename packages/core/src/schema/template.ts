import { z } from 'zod'
import { QUESTION_TYPES } from './question'

/**
 * A template is data, not a component. There is one generic PDF renderer driven by this JSON.
 * The template editor (a later phase) therefore edits only this structure.
 */

export const headerFieldSchema = z.object({
  /** Field key, e.g. `name`, `class`, `date`, `school`, `subject`. */
  key: z.string().min(1),
  label: z.string().min(1),
  /** Width as a percentage of the header row. */
  widthPercent: z.number().int().min(10).max(100).default(50),
  /** Prefilled value (school, subject). Empty = a line for the pupil. */
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
  title: z
    .object({
      show: z.boolean().default(true),
      fontSize: z.number().min(9).max(28).default(16),
      align: z.enum(['left', 'center']).default('center'),
      uppercase: z.boolean().default(false),
    })
    .prefault({}),
  fields: z.array(headerFieldSchema).default([]),
  /** Box for points and grade — rendered only for graded tests. */
  scoreBox: z.boolean().default(true),
  /** Horizontal rule below the header. */
  rule: z.boolean().default(true),
})

export const questionStyleSchema = z.object({
  /** Space above the question in points. */
  spacingBefore: z.number().min(0).max(40).default(10),
  /** Options of choice questions in two columns. */
  optionColumns: z.union([z.literal(1), z.literal(2)]).default(1),
  /** Height of one answer line in points (type `open`). */
  answerLineHeight: z.number().min(10).max(40).default(20),
  /** Box around the whole question. */
  boxed: z.boolean().default(false),
})

export const templateConfigSchema = z.object({
  page: pageStyleSchema.prefault({}),
  header: headerStyleSchema.prefault({}),
  /** Question numbering style. */
  numbering: z.enum(['decimal', 'decimal-dot', 'paren', 'none']).default('decimal-dot'),
  /** Show points next to the question (graded tests only). */
  showPoints: z.boolean().default(true),
  /** Footer with page number and variant. */
  footer: z.boolean().default(true),
  sectionStyle: z.object({
    fontSize: z.number().min(8).max(20).default(12),
    uppercase: z.boolean().default(false),
    rule: z.boolean().default(true),
    spacingBefore: z.number().min(0).max(60).default(16),
  }).prefault({}),
  /**
   * Fun fact box in a worksheet. The defaults keep existing templates working
   * unchanged — the setting was added together with worksheets. The label
   * default is stored template data.
   */
  funFact: z
    .object({
      label: z.string().default('Věděli jste?'),
      border: z.boolean().default(true),
      shaded: z.boolean().default(true),
    })
    .prefault({}),
  /** Default question style + overrides for specific types. */
  questionDefaults: questionStyleSchema.prefault({}),
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

/** Returns the effective style for the given question type (default + override). */
export function resolveQuestionStyle(
  config: TemplateConfig,
  type: (typeof QUESTION_TYPES)[number],
): QuestionStyle {
  return { ...config.questionDefaults, ...(config.questionStyles[type] ?? {}) }
}
