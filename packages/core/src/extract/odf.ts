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
  // `needsOcr` značí sken bez textové vrstvy — ODT/ODS jsou vždy textový
  // formát, krátký text tu znamená prázdný dokument, ne naskenovaný obrázek.
  return { text, pageCount: null, needsOcr: false }
}

/** Buňky, mezi kterými se při čtení tabulky vkládá oddělovač. */
const TABLE_CELL_TAGS = new Set(['table:table-cell', 'table:covered-table-cell'])

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
        // Bez oddělovače by obsah více buněk na řádku splynul do jedné věty
        // (druhá a další buňka nemá vlastní zalomení, jen text:p uvnitř).
        if (TABLE_CELL_TAGS.has(el.tagName) && previousCellSibling(el)) {
          out.push(' | ')
        }
        // Nadpis se od běžného textu jinak neliší — bez označení model
        // nepozná strukturu materiálu (kde končí kapitola, kde je téma).
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

/** Je před danou buňkou ve stejném řádku další buňka (i sloučená)? */
function previousCellSibling(el: Element): boolean {
  let sibling = el.previousElementSibling
  while (sibling) {
    if (TABLE_CELL_TAGS.has(sibling.tagName)) return true
    sibling = sibling.previousElementSibling
  }
  return false
}
