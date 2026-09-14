import { z } from 'zod'

/**
 * Přílohové bloky otázky — vykreslují se mezi zadáním a prostorem pro odpověď.
 * Obrázky se ve fázi 1 nahrávají ručně učitelem (tabulka `assets`).
 */

export const imageBlockSchema = z.object({
  kind: z.literal('image'),
  assetId: z.string().min(1),
  caption: z.string().max(300).optional(),
  /** Šířka v procentech šířky sloupce (10–100). */
  widthPercent: z.number().int().min(10).max(100).default(100),
})

export const tableCellSchema = z.object({
  text: z.string().default(''),
  header: z.boolean().default(false),
  /** Prázdná buňka k doplnění žákem. */
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
