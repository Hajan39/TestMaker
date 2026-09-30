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

/** Formáty čtené přes `DOMParser`. */
const DOM_EXTENSIONS = new Set(['odp', 'odt', 'ods', 'docx', 'html', 'htm'])

/**
 * Potřebuje soubor ke čtení `DOMParser`? Ve web workeru žádný není, takže
 * takové soubory se musí číst v hlavním vlákně stránky.
 */
export function potrebujeDom(fileName: string): boolean {
  return DOM_EXTENSIONS.has(fileExtension(fileName))
}

/** Extrahuje text podle přípony souboru. */
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
      // `needsOcr` značí sken bez textové vrstvy — TXT/MD je vždy textový
      // formát, krátký text tu znamená prázdný soubor, ne naskenovaný obrázek.
      return { text, pageCount: null, needsOcr: false }
    }
    case 'doc':
    case 'ppt':
    case 'xls':
      throw new UnsupportedFileError(file.name, 'Převeď soubor v LibreOffice nebo Wordu na .docx / .odp.')
    default:
      throw new UnsupportedFileError(file.name, 'Nepodporovaná přípona.')
  }
}

/** SHA-256 textu jako hex — brání opakovanému importu téhož obsahu. */
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

/** Zpracuje jeden soubor z výběru složky na materiál připravený k odeslání. */
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
