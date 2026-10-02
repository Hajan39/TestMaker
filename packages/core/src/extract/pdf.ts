/// <reference path="./pdfjs-worker.d.ts" />
import './uint8array-polyfill'
import { normalizeText, type ExtractionResult } from './types'

/**
 * PDF via pdf.js. The import is dynamic so the package can also be loaded on
 * the server, where extraction is not used.
 *
 * pdf.js's own worker is not started: extraction already runs in a web
 * worker, where pdf.js has no `window` or `workerSrc` and fails with "No
 * GlobalWorkerOptions.workerSrc specified". The worker module is therefore
 * loaded here and pdf.js uses it on the same thread.
 */
export async function extractPdf(data: ArrayBuffer | Uint8Array): Promise<ExtractionResult> {
  const [pdfjs, pdfjsWorker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs'),
  ])
  const global = globalThis as { pdfjsWorker?: unknown }
  global.pdfjsWorker ??= pdfjsWorker
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise

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
    await doc.cleanup()
  }

  const text = normalizeText(pages.join('\n\n'))
  const perPage = numPages > 0 ? text.length / numPages : 0
  return { text, pageCount: numPages, needsOcr: perPage < 50 }
}
