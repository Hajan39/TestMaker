import JSZip from 'jszip'
import { t } from '../i18n'
import { normalizeText, type ExtractionResult } from './types'

/** Heading styles Word and LibreOffice use to mark headings in `w:pStyle`. */
const HEADING_STYLE_RE = /^(Heading|Nadpis)/i

/** DOCX — a ZIP with `word/document.xml`; reads paragraphs, line breaks and table cells. */
export async function extractDocx(data: ArrayBuffer | Uint8Array): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(data)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error(t('core:extract.missingPart', { part: 'word/document.xml' }))
  const xml = await docFile.async('string')

  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error(t('core:extract.unreadablePart', { part: 'document.xml' }))

  const body = doc.getElementsByTagName('w:body')[0] ?? doc.documentElement
  const text = normalizeText(collectBody(body))
  // `needsOcr` marks a scan without a text layer — DOCX is always a text
  // format, a short text here means an empty document, not a scanned image.
  return { text, pageCount: null, needsOcr: false }
}

/** Text of one paragraph (`w:p`) including tabs and manual line breaks. */
function paragraphText(p: Element): string {
  const parts: string[] = []
  for (const node of Array.from(p.getElementsByTagName('*'))) {
    if (node.tagName === 'w:t') parts.push(node.textContent ?? '')
    else if (node.tagName === 'w:tab') parts.push(' ')
    else if (node.tagName === 'w:br') parts.push('\n')
  }
  return parts.join('')
}

/** Is the paragraph formatted as a heading? This lets the model see the material's structure. */
function isHeading(p: Element): boolean {
  const style = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val')
  return !!style && HEADING_STYLE_RE.test(style)
}

/**
 * Walks the document body by paragraphs and tables. Cells of the same row are
 * joined with a separator so they do not merge into one sentence of
 * continuous text.
 */
function collectBody(body: Element): string {
  const lines: string[] = []
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType !== 1) continue
    const el = node as Element
    if (el.tagName === 'w:p') {
      const text = paragraphText(el)
      lines.push(isHeading(el) ? `## ${text}` : text)
    } else if (el.tagName === 'w:tbl') {
      for (const row of Array.from(el.getElementsByTagName('w:tr'))) {
        const cells = Array.from(row.getElementsByTagName('w:tc')).map((cell) =>
          Array.from(cell.getElementsByTagName('w:p'))
            .map(paragraphText)
            .join(' ')
            .trim(),
        )
        lines.push(cells.join(' | '))
      }
    }
  }
  return lines.join('\n')
}
