import JSZip from 'jszip'
import { t } from '../i18n'
import { normalizeText, type ExtractionResult } from './types'

/**
 * ODP / ODT / ODS — a ZIP with `content.xml`. For presentations keeps slide
 * boundaries and appends the speaker notes, which often carry the continuous
 * explanation. The slide and notes markers are part of the extracted text.
 */
export async function extractOdf(data: ArrayBuffer | Uint8Array): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(data)
  const contentFile = zip.file('content.xml')
  if (!contentFile) throw new Error(t('core:extract.missingPart', { part: 'content.xml' }))
  const xml = await contentFile.async('string')

  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error(t('core:extract.unreadablePart', { part: 'content.xml' }))

  const pages = Array.from(doc.getElementsByTagName('draw:page'))
  if (pages.length > 0) {
    const slides = pages.map((page, index) => {
      const body = collectText(page, 'presentation:notes')
      const notesEl = page.getElementsByTagName('presentation:notes')[0]
      const notes = notesEl ? collectText(notesEl) : ''
      const parts = [`— Slide ${index + 1} —`, body]
      if (notes) parts.push(`Poznámky: ${notes}`)
      return parts.filter(Boolean).join('\n')
    })
    return { text: normalizeText(slides.join('\n\n')), pageCount: pages.length, needsOcr: false }
  }

  const bodyEl = doc.getElementsByTagName('office:body')[0] ?? doc.documentElement
  const text = normalizeText(collectText(bodyEl))
  // `needsOcr` marks a scan without a text layer — ODT/ODS are always a text
  // format, a short text here means an empty document, not a scanned image.
  return { text, pageCount: null, needsOcr: false }
}

/** Cells between which a separator is inserted when reading a table. */
const TABLE_CELL_TAGS = new Set(['table:table-cell', 'table:covered-table-cell'])

/** Collects text nodes and inserts line breaks at paragraph boundaries, skipping the given tag. */
function collectText(root: Element, skipTag?: string): string {
  const out: string[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out.push(child.nodeValue ?? '')
      } else if (child.nodeType === 1) {
        const el = child as Element
        if (skipTag && el.tagName === skipTag) continue
        if (el.tagName === 'text:s') {
          out.push(' '.repeat(Number(el.getAttribute('text:c') ?? '1')))
          continue
        }
        if (el.tagName === 'text:tab') {
          out.push(' ')
          continue
        }
        if (el.tagName === 'text:line-break') {
          out.push('\n')
          continue
        }
        // Without a separator the content of several cells in a row would merge
        // into one sentence (the second and later cells have no break of their own, only text:p inside).
        if (TABLE_CELL_TAGS.has(el.tagName) && previousCellSibling(el)) {
          out.push(' | ')
        }
        // A heading does not otherwise differ from ordinary text — without a marker
        // the model cannot see the material's structure (where a chapter ends, where the topic is).
        if (el.tagName === 'text:h') {
          out.push('## ')
        }
        walk(el)
        if (el.tagName === 'text:p' || el.tagName === 'text:h' || el.tagName === 'table:table-row') {
          out.push('\n')
        }
      }
    }
  }
  walk(root)
  return out.join('')
}

/** Is there another cell (including a merged one) before the given cell in the same row? */
function previousCellSibling(el: Element): boolean {
  let sibling = el.previousElementSibling
  while (sibling) {
    if (TABLE_CELL_TAGS.has(sibling.tagName)) return true
    sibling = sibling.previousElementSibling
  }
  return false
}
