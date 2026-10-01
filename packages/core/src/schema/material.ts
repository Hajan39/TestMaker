import { z } from 'zod'

/** Material after text extraction in the browser — only the text goes to the server, not the binary. */
export const extractedMaterialSchema = z.object({
  /** Relative path from the chosen folder, e.g. `PŘÍRODOPIS/8. ročník/Buňka.pdf`. */
  relativePath: z.string().min(1),
  fileName: z.string().min(1),
  subject: z.string().min(1),
  /** Grade; null for subjects without grades. */
  grade: z.string().nullable(),
  topic: z.string().min(1),
  mimeType: z.string().default('application/octet-stream'),
  sizeBytes: z.number().int().min(0),
  text: z.string(),
  pageCount: z.number().int().min(0).nullable(),
  /** Text is suspiciously short → probably a scan, waiting for OCR (phase 2). */
  needsOcr: z.boolean().default(false),
  /** SHA-256 of the extracted text, prevents duplicate imports. */
  contentHash: z.string().min(8),
})

export type ExtractedMaterial = z.infer<typeof extractedMaterialSchema>

export const importBatchSchema = z.object({
  materials: z.array(extractedMaterialSchema).min(1).max(50),
  /** When set, all materials go straight here — the subject/grade/topic fields are ignored. */
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
