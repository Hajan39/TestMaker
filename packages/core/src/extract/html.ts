import { normalizeText, type ExtractionResult } from './types.js'

/** HTML — textový obsah bez skriptů, stylů a navigace. */
export function extractHtml(html: string): ExtractionResult {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of Array.from(doc.querySelectorAll('script, style, noscript, svg, nav, footer'))) {
    el.remove()
  }
  const text = normalizeText(doc.body?.textContent ?? '')
  return { text, pageCount: null, needsOcr: text.length < 40 }
}
