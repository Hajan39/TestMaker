import type { Block } from '../schema/blocks'
import { answerLines, type ResolvedTestItem } from '../schema/test'
import { resolveQuestionStyle, type TemplateConfig } from '../schema/template'
import { buildPuzzle } from '../puzzle/index'
import { puzzleInstructions, type PuzzleContent } from '../schema/puzzle'
import {
  CRYPTOGRAM_NUMBER_WIDTH,
  WORD_LIST_COLUMNS,
  cellSize,
  cryptogramLayout,
  placedEntries,
  WORKSHEET_LAYOUT,
} from './layout'
import { mm } from './styles'

/** A4 height in points (PDF pt); 1 pt = 1/72". */
const PAGE_HEIGHT_PT = 842
/** A4 width in points. */
const PAGE_WIDTH_PT = 595.28

/**
 * Flat allowance for an image block — `QuestionBody.tsx` renders it at a
 * width given as a percentage of the column; the real height depends on the
 * image aspect ratio, which the estimate does not know. 130 pt matches a
 * typical illustration at medium scale (marginTop 6 + marginBottom 4 from
 * `BlockView` plus the image itself).
 */
const IMAGE_BLOCK_HEIGHT = 130

/** Height of one table block row — same estimate as `table_fill`. */
const TABLE_BLOCK_ROW_HEIGHT = 20

/** Table block margins (marginTop/marginBottom around the `View` in `BlockView`). */
const TABLE_BLOCK_MARGIN = 10

/** Height of one text line in points, derived from the template font size. */
function lineHeight(config: TemplateConfig): number {
  return config.page.fontSize * config.page.lineHeight
}

/** Rough estimate of the number of lines a question text of a given length takes. */
function promptLines(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.length / 70))
}

/**
 * Flat surcharge for a question attachment block (image or table) — without
 * it a test with attachments would come out a whole page shorter than it
 * really is. Precision is not expected, just the right order of magnitude.
 */
function blockHeight(block: Block): number {
  if (block.kind === 'image') return IMAGE_BLOCK_HEIGHT
  return block.rows.length * TABLE_BLOCK_ROW_HEIGHT + TABLE_BLOCK_MARGIN
}

/**
 * Estimated height of the test header (title, subtitle, field rows) — printed
 * only once, on the first page, so `paginate` adds it only there. Based on
 * what `Header` in `TestDocument.tsx` renders; test field values (title,
 * description) are not part of the config, so only the structure counts.
 */
function estimateHeaderHeight(config: TemplateConfig, heading?: PrintHeading): number {
  if (!config.header.show) return 0
  const line = lineHeight(config)
  // marginBottom of the whole header (`View` in `Header`).
  let height = 12
  if (config.header.title.show) {
    // Title line + marginBottom below it.
    height += config.header.title.fontSize + 8
  }
  const description = heading?.description?.trim()
  if (description) {
    // Test description (for a standalone puzzle its instructions) + marginBottom 6.
    height += wrappedLines(description, contentWidth(config), config.page.fontSize) * line + 6
  }
  if (config.header.fields.length > 0) {
    const totalWidthPercent = config.header.fields.reduce((sum, field) => sum + field.widthPercent, 0)
    const rows = Math.max(1, Math.ceil(totalWidthPercent / 100))
    // Field row (line or text) + marginBottom 6 from `Header`.
    height += rows * (line + 6)
  }
  return height
}

/**
 * Test title and description as printed by the header. The estimate uses
 * them to tell what the puzzle does not repeat (a standalone puzzle has its
 * title and instructions in the header) and, for a standalone puzzle, counts
 * the instructions into the header. Without them (builder preview) the puzzle
 * is counted with its title.
 */
export interface PrintHeading {
  title: string
  description?: string | null
}

/**
 * Which parts of the puzzle head are printed: title and instructions are
 * skipped when the test header already shows the same. One rule for
 * `TestDocument` and the estimate.
 */
export function puzzleHeadShown(
  puzzle: PuzzleContent,
  config: TemplateConfig,
  heading?: PrintHeading,
): { title: boolean; instructions: boolean } {
  const headerTitle = heading && config.header.show && config.header.title.show ? heading.title.trim() : null
  const headerText = heading && config.header.show ? (heading.description ?? '').trim() : null
  return {
    title: puzzle.title.trim() !== headerTitle,
    instructions: puzzleInstructions(puzzle).trim() !== headerText,
  }
}

/**
 * Safety margin for the item height estimate. Comparing with the actually
 * rendered PDF (see `render-samples.test.ts`) showed that the rough estimate
 * without a margin systematically underestimates the real height — for nine
 * sample questions in the compact template it predicted one page, the real
 * PDF needed two. A question also does not split across pages (except type
 * `open`), so even a small underestimate of earlier questions can push the
 * next question onto a new page and the estimate fails. The teacher decides
 * how many copies to print based on the estimate — better one page too many
 * in the preview than an unexpectedly incomplete printed test.
 */
const SAFETY_MARGIN = 1.15

/**
 * Estimated height of a rendered item in points (PDF pt). Serves the rough
 * browser preview and pagination — not an exact layout, just enough for the
 * test to split into pages roughly like the real PDF (with a margin, see
 * `SAFETY_MARGIN`).
 */
export function estimateHeight(item: ResolvedTestItem, config: TemplateConfig, heading?: PrintHeading): number {
  if (item.kind === 'page_break') return 0
  const parts = puzzleParts(item, config, heading)
  if (parts) return sum(parts) * PUZZLE_SAFETY_MARGIN
  const table = tableParts(item, config)
  if (item.kind === 'table') return table ? sum(table) * SAFETY_MARGIN : 0
  return rawEstimateHeight(item, config) * SAFETY_MARGIN
}

/**
 * Puzzles are computed almost exactly (cell and box sizes are fixed, text
 * wraps by letter widths), so a small margin suffices — a large one would
 * needlessly push the puzzle to the next page and break it where it fits.
 */
const PUZZLE_SAFETY_MARGIN = 1.01

/**
 * Fraction of the page height a puzzle must fit into (by estimate) to be
 * printed unbroken. The margin covers estimate error: react-pdf squashes an
 * unbreakable block taller than the page and the print becomes useless.
 */
const KEEP_TOGETHER_LIMIT = 0.9

/** Usable page height (without top and bottom margins). */
export function usablePageHeight(config: TemplateConfig): number {
  return PAGE_HEIGHT_PT - mm(config.page.marginTopMm) - mm(config.page.marginBottomMm)
}

/**
 * Is the puzzle printed as one unbreakable block? Yes when, by estimate, it
 * fits a page with a margin — then it rather moves whole to the next page than
 * have the word list torn from the grid. A taller puzzle breaks by rows. Both
 * `TestDocument` and `paginate` use this so the preview breaks like the PDF.
 */
export function puzzleKeepsTogether(item: ResolvedTestItem, config: TemplateConfig, heading?: PrintHeading): boolean {
  return estimateHeight(item, config, heading) <= usablePageHeight(config) * KEEP_TOGETHER_LIMIT
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0)

/**
 * Average character width in em — measured on Noto Sans/Serif over Czech text
 * (lowercase about 0.48 em, uppercase about 0.6 em, space 0.26 em).
 */
function charWidth(char: string): number {
  if (char === ' ') return 0.26
  return char !== char.toLowerCase() ? 0.6 : 0.5
}

/**
 * How many lines a text takes at a given width. React-pdf wraps by words
 * (hyphenation is disabled, see `fonts.ts`), so it wraps the same here.
 */
export function wrappedLines(text: string, width: number, fontSize: number): number {
  const space = charWidth(' ') * fontSize
  let lines = 1
  let used = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = [...word].reduce((total, char) => total + charWidth(char), 0) * fontSize
    if (used > 0 && used + space + w > width) {
      lines += 1
      used = w
    } else {
      used += (used > 0 ? space : 0) + w
    }
  }
  return lines
}

/** Width of the page text area. */
function contentWidth(config: TemplateConfig): number {
  return PAGE_WIDTH_PT - mm(config.page.marginLeftMm) - mm(config.page.marginRightMm)
}

/**
 * Puzzle height in unbreakable chunks, in exactly the order `PuzzleBody`
 * prints them: the first chunk is the head with the grid (or the cryptogram
 * boxes), the rest are individual list rows, between which a page break may
 * fall. Returns `null` for an item that is not a puzzle.
 */
export function puzzleParts(item: ResolvedTestItem, config: TemplateConfig, heading?: PrintHeading): number[] | null {
  if (item.kind !== 'puzzle' || !item.puzzle) return null
  const puzzle = item.puzzle
  const width = contentWidth(config)
  // React-pdf converts the page line height (a multiplier) to points using the
  // page font and children inherit it in points — so a title line and a small
  // text line (9 pt) are as tall as a normal text line. Measured.
  const pageLine = lineHeight(config)
  const small = 9
  const smallLine = pageLine

  const shown = puzzleHeadShown(puzzle, config, heading)
  const head =
    // Without title and instructions the space above the puzzle goes too (see `PuzzleView`).
    (shown.title || shown.instructions ? config.sectionStyle.spacingBefore : 0) +
    (shown.title ? pageLine : 0) +
    (shown.instructions ? wrappedLines(puzzleInstructions(puzzle), width, config.page.fontSize) * pageLine : 0)

  const built = buildPuzzle(puzzle)
  if (built.kind === 'wordsearch') {
    const grid = 6 + built.wordSearch.rows * cellSize(built.wordSearch.cols)
    const showClues = puzzle.kind === 'wordsearch' && puzzle.payload.showClues
    const columnWidth = width / WORD_LIST_COLUMNS - 6
    const entries = placedEntries(puzzle, built)
    const rows: number[] = []
    for (let i = 0; i < entries.length; i += WORD_LIST_COLUMNS) {
      const lines = Math.max(
        ...entries
          .slice(i, i + WORD_LIST_COLUMNS)
          .map((entry) =>
            wrappedLines(`${entry.word.toUpperCase()}${showClues ? ` – ${entry.clue}` : ''}`, columnWidth, small),
          ),
      )
      // marginTop 8 above the list is added to the first row.
      rows.push(lines * smallLine + 2 + (i === 0 ? 8 : 0))
    }
    return [head + grid, ...rows]
  }

  const result = built.cryptogram
  const { boxSize } = cryptogramLayout(result)
  // Phrase boxes wrap by words (8 pt between words).
  let phraseLines = 1
  let used = 0
  for (const word of result.phraseWords) {
    const w = word.length * boxSize + 8
    if (used > 0 && used + w > width) {
      phraseLines += 1
      used = w
    } else used += w
  }
  const phrase = 6 + smallLine + 3 + phraseLines * (boxSize + 2) + 8
  const label = smallLine + 3
  const gridRows = result.rows.map((_, i) => boxSize + 3 + (i === 0 ? label : 0))
  const clueWidth = width - CRYPTOGRAM_NUMBER_WIDTH - 6
  const clues = result.rows.map(
    (row, i) => wrappedLines(row.clue, clueWidth, small) * smallLine + 3 + (i === 0 ? 8 + label : 0),
  )
  return [head + phrase, ...gridRows, ...clues]
}

/** Worksheet table row height: the tallest cell, at least room for handwriting. */
function tableRowHeight(cells: string[], config: TemplateConfig): number {
  const cellWidth = contentWidth(config) / cells.length - 2 * WORKSHEET_LAYOUT.cellPadding
  const lines = Math.max(...cells.map((cell) => wrappedLines(cell, cellWidth, config.page.fontSize)))
  return Math.max(WORKSHEET_LAYOUT.rowMinHeight, lines * lineHeight(config) + 2 * WORKSHEET_LAYOUT.cellPadding)
}

/** Table header height — printed again on every following page. */
export function tableHeaderHeight(item: ResolvedTestItem, config: TemplateConfig): number {
  if (item.kind !== 'table' || !item.table) return 0
  const cellWidth = contentWidth(config) / item.table.header.length - 2 * WORKSHEET_LAYOUT.cellPadding
  const lines = Math.max(...item.table.header.map((title) => wrappedLines(title, cellWidth, config.page.fontSize)))
  return lines * lineHeight(config) + 2 * WORKSHEET_LAYOUT.cellPadding
}

/**
 * Worksheet table height in unbreakable chunks as `TableBlock` prints them:
 * the first chunk is spacing, caption, header and first row (the header never
 * separates from the rows), the rest are individual rows. Returns `null` for
 * any other item (including a broken table).
 */
export function tableParts(item: ResolvedTestItem, config: TemplateConfig): number[] | null {
  if (item.kind !== 'table' || !item.table) return null
  const table = item.table
  const caption = table.caption
    ? wrappedLines(table.caption, contentWidth(config), config.page.fontSize) * lineHeight(config)
    : 0
  const rows = table.rows.map((row) => tableRowHeight(row.map((cell) => cell.value), config))
  const [first = 0, ...rest] = rows
  return [WORKSHEET_LAYOUT.blockSpacing + caption + tableHeaderHeight(item, config) + first, ...rest]
}

function rawEstimateHeight(item: ResolvedTestItem, config: TemplateConfig): number {
  const line = lineHeight(config)

  if (item.kind === 'text') {
    const text = item.text ?? ''
    if (item.textContent?.variant !== 'fun_fact') {
      return WORKSHEET_LAYOUT.textSpacing + wrappedLines(text, contentWidth(config), config.page.fontSize) * line
    }
    const inner = contentWidth(config) - 2 * WORKSHEET_LAYOUT.funFactPadding - 2
    return (
      WORKSHEET_LAYOUT.blockSpacing +
      2 * WORKSHEET_LAYOUT.funFactPadding +
      (config.funFact.label ? line : 0) +
      wrappedLines(text, inner, config.page.fontSize) * line
    )
  }

  if (item.kind === 'heading') {
    return config.sectionStyle.spacingBefore + config.sectionStyle.fontSize * 1.6
  }

  if (item.kind === 'instruction') {
    return 12 + promptLines(item.text ?? '') * line
  }

  const question = item.question
  if (!question) return 0

  const style = resolveQuestionStyle(config, question.type)
  const base = style.spacingBefore + promptLines(question.payload.prompt) * line

  let body: number
  switch (question.type) {
    case 'open':
    case 'draw':
      body = answerLines(question, item.linesOverride) * style.answerLineHeight
      break
    case 'short_answer':
      body = 20
      break
    case 'single_choice':
    case 'multi_choice': {
      const rows = Math.ceil(question.payload.options.length / style.optionColumns)
      body = rows * (line + 4)
      break
    }
    case 'true_false':
      // header row + one row per statement
      body = (question.payload.statements.length + 1) * 18
      break
    case 'fill_blank':
      body = line * 2 + (question.payload.wordBank.length > 0 ? 24 : 0)
      break
    case 'matching':
      body = Math.max(question.payload.left.length, question.payload.right.length) * 19
      break
    case 'ordering':
      body = question.payload.items.length * 19
      break
    case 'table_fill':
      // header row + data rows
      body = (question.payload.rows.length + 1) * 20
      break
    case 'label_image':
      body = 100 + question.payload.labels.length * 17
      break
    default:
      body = 20
  }

  const blocksHeight = question.blocks.reduce((sum, block) => sum + blockHeight(block), 0)

  return base + blocksHeight + body
}

/**
 * Splits test items into pages by estimated height. A break (`page_break`)
 * always starts a new page, even if the rest would fit.
 *
 * A puzzle not printed as one block (see `puzzleKeepsTogether`) breaks by
 * rows just like in the PDF: it belongs to the page where it starts, but its
 * rest takes space on the following pages. A page that only receives the
 * overflow of a puzzle is empty in the list — it is still printed, so the
 * page count must match.
 */
export function paginate(
  items: ResolvedTestItem[],
  config: TemplateConfig,
  heading?: PrintHeading,
): ResolvedTestItem[][] {
  const usableHeight = usablePageHeight(config)
  const firstContent = items.findIndex((item) => item.kind !== 'page_break')

  const pages: ResolvedTestItem[][] = []
  let current: ResolvedTestItem[] = []
  // The header is printed only once on the first page, so it takes space only there.
  let used = estimateHeaderHeight(config, heading)
  // The rest of a puzzle overflowed onto this page from the previous one — the page is not empty.
  let continued = false

  const newPage = () => {
    pages.push(current)
    current = []
    used = 0
    continued = false
  }

  items.forEach((item, index) => {
    if (item.kind === 'page_break') {
      if (current.length > 0 || continued) newPage()
      return
    }

    const parts = puzzleParts(item, config, heading)
    if (parts && (index === firstContent || !puzzleKeepsTogether(item, config, heading))) {
      const scaled = parts.map((part) => part * PUZZLE_SAFETY_MARGIN)
      const [head = 0, ...rows] = scaled
      if ((current.length > 0 || continued) && used + head > usableHeight) newPage()
      current.push(item)
      used += head
      for (const row of rows) {
        if (used + row > usableHeight) {
          newPage()
          continued = true
        }
        used += row
      }
      return
    }

    // A worksheet table breaks by rows; the header repeats before the rows on
    // the next page, so it takes space there too.
    const table = tableParts(item, config)
    if (table) {
      const header = tableHeaderHeight(item, config) * SAFETY_MARGIN
      const [head = 0, ...rows] = table.map((part) => part * SAFETY_MARGIN)
      if ((current.length > 0 || continued) && used + head > usableHeight) newPage()
      current.push(item)
      used += head
      for (const row of rows) {
        if (used + row > usableHeight) {
          newPage()
          continued = true
          used = header
        }
        used += row
      }
      return
    }

    const height = estimateHeight(item, config, heading)
    if ((current.length > 0 || continued) && used + height > usableHeight) newPage()

    current.push(item)
    used += height
  })

  if (current.length > 0 || continued || pages.length === 0) pages.push(current)

  return pages
}
