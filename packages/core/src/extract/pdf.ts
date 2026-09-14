import { normalizeText, type ExtractionResult } from './types.js'

/**
 * PDF přes pdf.js. Import je dynamický, aby balíček šel načíst i na serveru,
 * kde se extrakce nepoužívá.
 */
export async function extractPdf(data: ArrayBuffer | Uint8Array): Promise<ExtractionResult> {
  const pdfjs = await import('pdfjs-dist')
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise

  const numPages = doc.numPages
  const pages: string[] = []
  try {
    for (let i = 1; i <= numPages; i += 1) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const line: string[] = []
      let lastY: number | null = null
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = item.transform[5] as number
        if (lastY !== null && Math.abs(y - lastY) > 2) line.push('\n')
        line.push(item.str)
        if (item.hasEOL) line.push('\n')
        lastY = y
      }
      pages.push(line.join(''))
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }

  const text = normalizeText(pages.join('\n\n'))
  const perPage = numPages > 0 ? text.length / numPages : 0
  return { text, pageCount: numPages, needsOcr: perPage < 50 }
}
