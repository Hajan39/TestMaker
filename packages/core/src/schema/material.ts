import { z } from 'zod'

/** Materiál po extrakci textu v prohlížeči — na server jde jen text, ne binárka. */
export const extractedMaterialSchema = z.object({
  /** Relativní cesta ze zvolené složky, např. `PŘÍRODOPIS/8. ročník/Buňka.pdf`. */
  relativePath: z.string().min(1),
  fileName: z.string().min(1),
  subject: z.string().min(1),
  /** Ročník; u předmětů bez členění null. */
  grade: z.string().nullable(),
  topic: z.string().min(1),
  mimeType: z.string().default('application/octet-stream'),
  sizeBytes: z.number().int().min(0),
  text: z.string(),
  pageCount: z.number().int().min(0).nullable(),
  /** Text je podezřele krátký → pravděpodobně sken, čeká na OCR (fáze 2). */
  needsOcr: z.boolean().default(false),
  /** SHA-256 extrahovaného textu, brání duplicitnímu importu. */
  contentHash: z.string().min(8),
})

export type ExtractedMaterial = z.infer<typeof extractedMaterialSchema>

export const importBatchSchema = z.object({
  materials: z.array(extractedMaterialSchema).min(1).max(50),
  /** Když je vyplněné, jdou všechny materiály rovnou sem — pole subject/grade/topic se ignorují. */
  topicId: z.string().min(1).optional(),
})

export interface Material {
  id: string
  topicId: string
  fileName: string
  relativePath: string
  mimeType: string
  sizeBytes: number
  text: string
  charCount: number
  pageCount: number | null
  needsOcr: boolean
  contentHash: string
  createdAt: string
}
