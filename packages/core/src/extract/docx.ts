import JSZip from 'jszip'
import { normalizeText, type ExtractionResult } from './types'

/** DOCX — ZIP s `word/document.xml`; čte odstavce, zalomení a buňky tabulek. */
export async function extractDocx(data: ArrayBuffer | Uint8Array): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(data)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('Soubor neobsahuje word/document.xml')
  const xml = await docFile.async('string')

  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('document.xml se nepodařilo načíst')

  const paragraphs = Array.from(doc.getElementsByTagName('w:p')).map((p) => {
    const parts: string[] = []
    for (const node of Array.from(p.getElementsByTagName('*'))) {
      if (node.tagName === 'w:t') parts.push(node.textContent ?? '')
      else if (node.tagName === 'w:tab') parts.push(' ')
      else if (node.tagName === 'w:br') parts.push('\n')
    }
    return parts.join('')
  })

  const text = normalizeText(paragraphs.join('\n'))
  return { text, pageCount: null, needsOcr: text.length < 40 }
}
