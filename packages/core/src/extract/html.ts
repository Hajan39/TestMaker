import { normalizeText, type ExtractionResult } from './types'

/** HTML — textový obsah bez skriptů, stylů a navigace. */
export function extractHtml(html: string): ExtractionResult {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of Array.from(doc.querySelectorAll('script, style, noscript, svg, nav, footer'))) {
    el.remove()
  }
  const text = normalizeText(doc.body?.textContent ?? '')
  // `needsOcr` značí sken bez textové vrstvy — u HTML to nemá smysl, krátký
  // text tu vždycky znamená prázdnou stránku, ne naskenovaný obrázek.
  return { text, pageCount: null, needsOcr: false }
}
