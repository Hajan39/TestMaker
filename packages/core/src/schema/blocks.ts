import { z } from 'zod'

/**
 * Attachment blocks of a question — rendered between the prompt and the answer space.
 * In phase 1 images are uploaded manually by the teacher (table `assets`).
 */

export const imageBlockSchema = z.object({
  kind: z.literal('image'),
  assetId: z.string().min(1),
  caption: z.string().max(300).optional(),
  /** Width as a percentage of the column width (10–100). */
  widthPercent: z.number().int().min(10).max(100).default(100),
})

export const tableCellSchema = z.object({
  text: z.string().default(''),
  header: z.boolean().default(false),
  /** Blank cell for the pupil to fill in. */
  blank: z.boolean().default(false),
  colSpan: z.number().int().min(1).max(12).optional(),
})

export const tableBlockSchema = z.object({
  kind: z.literal('table'),
  caption: z.string().max(300).optional(),
  rows: z.array(z.array(tableCellSchema).min(1)).min(1),
})

export const blockSchema = z.discriminatedUnion('kind', [imageBlockSchema, tableBlockSchema])

export type ImageBlock = z.infer<typeof imageBlockSchema>
export type TableCell = z.infer<typeof tableCellSchema>
export type TableBlock = z.infer<typeof tableBlockSchema>
export type Block = z.infer<typeof blockSchema>
