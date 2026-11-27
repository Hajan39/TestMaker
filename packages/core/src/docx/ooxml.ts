import JSZip from 'jszip'

/**
 * Minimal WordprocessingML writer — only what a test needs: paragraphs, runs,
 * tables and inline images. Sizes come in points, as in the PDF renderer;
 * Word's own units (twips, half-points, EMU) stay inside this file.
 *
 * Child elements are written in the order the schema prescribes. Word is
 * strict about it: a file with e.g. `w:jc` before `w:spacing` opens as
 * "damaged" even though every element is valid on its own.
 */

const twips = (points: number): number => Math.round(points * 20)
const hex = (color: string): string => color.replace('#', '').toUpperCase()

/** XML 1.0 has no way to carry most control characters, not even escaped. */
const escapeXml = (text: string): string =>
  text
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

export interface RunStyle {
  bold?: boolean
  italic?: boolean
  color?: string
  /** Font size in points. */
  size?: number
}

/** A run of text; `\n` becomes a line break and `\t` a tab. */
export function run(text: string, style: RunStyle = {}): string {
  const size = style.size ? Math.round(style.size * 2) : 0
  const props =
    (style.bold ? '<w:b/>' : '') +
    (style.italic ? '<w:i/>' : '') +
    (style.color ? `<w:color w:val="${hex(style.color)}"/>` : '') +
    (size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '')
  const content = text
    .replace(/\r\n?/g, '\n')
    .split(/(\n|\t)/)
    .map((part) =>
      part === '\n' ? '<w:br/>' : part === '\t' ? '<w:tab/>' : part ? `<w:t xml:space="preserve">${escapeXml(part)}</w:t>` : '',
    )
    .join('')
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${content}</w:r>`
}

export interface ParagraphStyle {
  align?: 'left' | 'center' | 'right'
  /** Space above and below in points. */
  before?: number
  after?: number
  /** Line height as a multiple of the font size. */
  line?: number
  /** Fixed line height in points — an empty paragraph keeps exactly this height. */
  exactLine?: number
  /** Colour of a rule below the paragraph. */
  rule?: string
  /** Stay on the same page as the next paragraph. */
  keepNext?: boolean
}

export function paragraph(runs: string | string[], style: ParagraphStyle = {}): string {
  const spacing = [
    style.before !== undefined ? ` w:before="${twips(style.before)}"` : '',
    style.after !== undefined ? ` w:after="${twips(style.after)}"` : '',
    style.exactLine !== undefined
      ? ` w:line="${twips(style.exactLine)}" w:lineRule="exact"`
      : style.line !== undefined
        ? ` w:line="${Math.round(style.line * 240)}" w:lineRule="auto"`
        : '',
  ].join('')
  const props =
    (style.keepNext ? '<w:keepNext/>' : '') +
    (style.rule ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${hex(style.rule)}"/></w:pBdr>` : '') +
    (spacing ? `<w:spacing${spacing}/>` : '') +
    (style.align ? `<w:jc w:val="${style.align}"/>` : '')
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${Array.isArray(runs) ? runs.join('') : runs}</w:p>`
}

export const pageBreak = (): string => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

export interface Cell {
  /** Paragraphs of the cell; an empty cell gets the one paragraph Word requires. */
  content?: string
  span?: number
  shade?: string
  /** `thin` is the usual grid line, `thick` marks a cell, `bottom` is a line to write on, `none` is frameless. */
  border?: 'thin' | 'thick' | 'bottom' | 'none'
}

export interface TableOptions {
  /** Width of every grid column in points. */
  widths: number[]
  /** Frame of cells that do not set their own. */
  border?: Cell['border']
  /** Colour of thin frames; grey when left out. */
  color?: string
  /** Row height in points — a minimum, or the exact height with `exactHeight`. */
  rowHeight?: number
  exactHeight?: boolean
  /** Inner cell padding in points; Word's default when left out. */
  padding?: number
  /** Centre the table (and the text of its cells vertically) — letter grids. */
  centered?: boolean
}

function cellBorders(frame: NonNullable<Cell['border']>, color: string): string {
  if (frame === 'none') return ''
  const sides = frame === 'bottom' ? ['bottom'] : ['top', 'left', 'bottom', 'right']
  const edge = frame === 'thick' ? 'w:sz="12" w:space="0" w:color="111111"' : `w:sz="4" w:space="0" w:color="${hex(color)}"`
  return `<w:tcBorders>${sides.map((side) => `<w:${side} w:val="single" ${edge}/>`).join('')}</w:tcBorders>`
}

/**
 * A table. Frames are set cell by cell, not on the table: a letter grid has
 * framed and frameless cells side by side, and where both a table and a cell
 * rule exist Word's choice between them is hard to predict.
 */
export function table(rows: Cell[][], options: TableOptions): string {
  const { widths, border = 'thin', color = '#666666', rowHeight, exactHeight = false, padding, centered = false } = options
  const margin = (side: string) => `<w:${side} w:w="${twips(padding ?? 0)}" w:type="dxa"/>`
  const tableProps =
    `<w:tblW w:w="${twips(widths.reduce((sum, width) => sum + width, 0))}" w:type="dxa"/>` +
    (centered ? '<w:jc w:val="center"/>' : '') +
    '<w:tblLayout w:type="fixed"/>' +
    (padding !== undefined ? `<w:tblCellMar>${['top', 'left', 'bottom', 'right'].map(margin).join('')}</w:tblCellMar>` : '')
  const rowProps =
    '<w:cantSplit/>' +
    (rowHeight ? `<w:trHeight w:val="${twips(rowHeight)}" w:hRule="${exactHeight ? 'exact' : 'atLeast'}"/>` : '')

  const body = rows
    .map((row) => {
      let column = 0
      const cells = row.map((cell) => {
        const span = cell.span ?? 1
        const width = widths.slice(column, column + span).reduce((sum, value) => sum + value, 0)
        column += span
        const cellProps =
          `<w:tcW w:w="${twips(width)}" w:type="dxa"/>` +
          (span > 1 ? `<w:gridSpan w:val="${span}"/>` : '') +
          cellBorders(cell.border ?? border, color) +
          (cell.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(cell.shade)}"/>` : '') +
          (centered ? '<w:vAlign w:val="center"/>' : '')
        return `<w:tc><w:tcPr>${cellProps}</w:tcPr>${cell.content || '<w:p/>'}</w:tc>`
      })
      return `<w:tr><w:trPr>${rowProps}</w:trPr>${cells.join('')}</w:tr>`
    })
    .join('')
  const grid = widths.map((width) => `<w:gridCol w:w="${twips(width)}"/>`).join('')
  return `<w:tbl><w:tblPr>${tableProps}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`
}

/** An image stored in the package; its position in the list is its number in `image()`. */
export interface EmbeddedImage {
  /** `png`, `jpeg` or `gif` — what Word displays everywhere. */
  extension: string
  base64: string
}

const EMU_PER_POINT = 12700

/** An inline picture as a run. `number` counts embedded images from one. */
export function image(number: number, width: number, height: number): string {
  const size = `cx="${Math.round(width * EMU_PER_POINT)}" cy="${Math.round(height * EMU_PER_POINT)}"`
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent ${size}/><wp:docPr id="${number}" name="Picture ${number}"/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${number}" name="Picture ${number}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="image${number}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${size}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  )
}

/** Pixel size of a PNG, JPEG or GIF read from its header; `null` for anything else. */
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  if (bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.toString('latin1', 0, 3) === 'GIF') return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (bytes.readUInt16BE(0) !== 0xffd8) return null
  // JPEG: walk the segments up to the frame header (SOFn), which carries the size.
  let offset = 2
  while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]!
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
    }
    offset += 2 + bytes.readUInt16BE(offset + 2)
  }
  return null
}

export interface DocumentOptions {
  /** A4 page margins in points. */
  margins: { top: number; right: number; bottom: number; left: number }
  font: string
  fontSize: number
  lineHeight: number
  images: EmbeddedImage[]
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'

/** Wraps the body into a `.docx` package. */
export async function packDocument(body: string, options: DocumentOptions): Promise<Buffer> {
  const { margins, font, images } = options
  const size = Math.round(options.fontSize * 2)
  const zip = new JSZip()

  zip.file(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      ['png', 'jpeg', 'gif'].map((type) => `<Default Extension="${type}" ContentType="image/${type}"/>`).join('') +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    `${XML}<Relationships xmlns="${PACKAGE_RELS}"><Relationship Id="document" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `${XML}<Relationships xmlns="${PACKAGE_RELS}"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/>` +
      images
        .map((item, i) => `<Relationship Id="image${i + 1}" Type="${R}/image" Target="media/image${i + 1}.${item.extension}"/>`)
        .join('') +
      '</Relationships>',
  )
  images.forEach((item, i) => zip.file(`word/media/image${i + 1}.${item.extension}`, item.base64, { base64: true }))
  zip.file(
    'word/styles.xml',
    // Font and spacing sit on the default paragraph style, not in `docDefaults`:
    // Pages and Quick Look ignore the latter and fall back to their own font.
    `${XML}<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>` +
      `<w:pPr><w:spacing w:after="0" w:line="${Math.round(options.lineHeight * 240)}" w:lineRule="auto"/></w:pPr>` +
      `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>` +
      `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="cs-CZ"/></w:rPr></w:style></w:styles>`,
  )
  zip.file(
    'word/document.xml',
    `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
      `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
      `<w:pgMar w:top="${twips(margins.top)}" w:right="${twips(margins.right)}" w:bottom="${twips(margins.bottom)}" w:left="${twips(margins.left)}" w:header="708" w:footer="708" w:gutter="0"/>` +
      '</w:sectPr></w:body></w:document>',
  )
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
