import { t } from '../i18n'
import type { ExtractedMaterial } from '../schema/material'
import { extractDocx } from './docx'
import { extractHtml } from './html'
import { extractOdf } from './odf'
import { extractPdf } from './pdf'
import { fileExtension, parsePath, skipReason } from './paths'
import { normalizeText, UnsupportedFileError, type ExtractionResult } from './types'

export * from './paths'
export * from './similarity'
export * from './grouping'
export * from './types'
export { extractDocx, extractHtml, extractOdf, extractPdf }

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  odp: 'application/vnd.oasis.opendocument.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
}

/** Formats read via `DOMParser`. */
const DOM_EXTENSIONS = new Set(['odp', 'odt', 'ods', 'docx', 'html', 'htm'])

/**
 * Does reading the file need `DOMParser`? A web worker has none, so such
 * files must be read on the page's main thread.
 */
export function needsDom(fileName: string): boolean {
  return DOM_EXTENSIONS.has(fileExtension(fileName))
}

/** Extracts text according to the file extension. */
export async function extractFile(file: File): Promise<ExtractionResult> {
  const ext = fileExtension(file.name)
  switch (ext) {
    case 'pdf':
      return extractPdf(await file.arrayBuffer())
    case 'odp':
    case 'odt':
    case 'ods':
      return extractOdf(await file.arrayBuffer())
    case 'docx':
      return extractDocx(await file.arrayBuffer())
    case 'html':
    case 'htm':
      return extractHtml(await file.text())
    case 'txt':
    case 'md': {
      const text = normalizeText(await file.text())
      // `needsOcr` marks a scan without a text layer — TXT/MD is always a text
      // format, a short text here means an empty file, not a scanned image.
      return { text, pageCount: null, needsOcr: false }
    }
    case 'doc':
    case 'ppt':
    case 'xls':
      throw new UnsupportedFileError(file.name, t('core:extract.hints.legacyFormat'))
    default:
      throw new UnsupportedFileError(file.name, t('core:extract.hints.unknownExtension'))
  }
}

/** SHA-256 of the text as hex — prevents importing the same content twice. */
export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface ProcessedFile {
  status: 'ok' | 'skipped' | 'error'
  relativePath: string
  material?: ExtractedMaterial
  reason?: string
}

/** Processes one file from the folder selection into a material ready to be sent. */
export async function processFile(file: File, relativePathOverride?: string): Promise<ProcessedFile> {
  const relativePath =
    relativePathOverride ??
    ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)

  const skip = skipReason(relativePath)
  if (skip) return { status: 'skipped', relativePath, reason: skip }

  try {
    const parsed = parsePath(relativePath)
    const result = await extractFile(file)
    if (result.text.length < 40 && !result.needsOcr) {
      // The reason is a code the web maps to a message (`skipLabel`), like `SkipReason`.
      return { status: 'skipped', relativePath, reason: 'prázdný text' }
    }
    return {
      status: 'ok',
      relativePath,
      material: {
        relativePath,
        fileName: parsed.fileName,
        subject: parsed.subject,
        grade: parsed.grade,
        topic: parsed.topic,
        mimeType: MIME_BY_EXT[parsed.extension] ?? file.type ?? 'application/octet-stream',
        sizeBytes: file.size,
        text: result.text,
        pageCount: result.pageCount,
        needsOcr: result.needsOcr,
        contentHash: await hashText(result.text),
      },
    }
  } catch (error) {
    return {
      status: 'error',
      relativePath,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
