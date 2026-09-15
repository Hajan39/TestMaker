import JSZip from 'jszip'
import { normalizeText, type ExtractionResult } from './types'

/** Styly nadpisů, kterými Word i LibreOffice značí nadpisy v `w:pStyle`. */
const HEADING_STYLE_RE = /^(Heading|Nadpis)/i

/** DOCX — ZIP s `word/document.xml`; čte odstavce, zalomení a buňky tabulek. */
export async function extractDocx(data: ArrayBuffer | Uint8Array): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(data)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('Soubor neobsahuje word/document.xml')
  const xml = await docFile.async('string')

  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('document.xml se nepodařilo načíst')

  const body = doc.getElementsByTagName('w:body')[0] ?? doc.documentElement
  const text = normalizeText(collectBody(body))
  return { text, pageCount: null, needsOcr: text.length < 40 }
}

/** Text jednoho odstavce (`w:p`) včetně tabulátorů a ručních zalomení. */
function paragraphText(p: Element): string {
  const parts: string[] = []
  for (const node of Array.from(p.getElementsByTagName('*'))) {
    if (node.tagName === 'w:t') parts.push(node.textContent ?? '')
    else if (node.tagName === 'w:tab') parts.push(' ')
    else if (node.tagName === 'w:br') parts.push('\n')
  }
  return parts.join('')
}

/** Je odstavec formátovaný jako nadpis? Model tak pozná strukturu materiálu. */
function isHeading(p: Element): boolean {
  const style = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val')
  return !!style && HEADING_STYLE_RE.test(style)
}

/**
 * Projde tělo dokumentu po odstavcích a tabulkách. Buňky téhož řádku spojuje
 * oddělovačem, aby se nesloučily do jedné věty jako spojitý text.
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
