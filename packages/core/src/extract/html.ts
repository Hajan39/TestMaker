import { normalizeText, type ExtractionResult } from './types'

/** HTML — text content without scripts, styles and navigation. */
export function extractHtml(html: string): ExtractionResult {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of Array.from(doc.querySelectorAll('script, style, noscript, svg, nav, footer'))) {
    el.remove()
  }
  const text = normalizeText(doc.body?.textContent ?? '')
  // `needsOcr` marks a scan without a text layer — meaningless for HTML, a
  // short text here always means an empty page, not a scanned image.
  return { text, pageCount: null, needsOcr: false }
}
