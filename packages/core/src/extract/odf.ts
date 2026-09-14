import JSZip from 'jszip'
import { normalizeText, type ExtractionResult } from './types'

/**
 * ODP / ODT / ODS — ZIP s `content.xml`. U prezentací zachovává hranice slidů
 * a připojuje poznámky přednášejícího, které často nesou souvislý výklad.
 */
export async function extractOdf(data: ArrayBuffer | Uint8Array): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(data)
  const contentFile = zip.file('content.xml')
  if (!contentFile) throw new Error('Soubor neobsahuje content.xml')
  const xml = await contentFile.async('string')

  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('content.xml se nepodařilo načíst')

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
  return { text, pageCount: null, needsOcr: text.length < 40 }
}

/** Posbírá textové uzly a vloží zalomení na hranicích odstavců, s vynecháním daných tagů. */
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
