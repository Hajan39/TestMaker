import { t } from '../i18n'
import { puzzleHeadShown } from '../pdf/estimate'
import {
  IMAGE_MAX_HEIGHT,
  LETTERS,
  PAGE_WIDTH,
  PUZZLE_USABLE_WIDTH,
  WORD_LIST_COLUMNS,
  WORKSHEET_LAYOUT as L,
  cellSize,
  cryptogramLayout,
  cryptogramPhraseCells,
  displayOrder,
  formatPoints,
  numberedBlanks,
  placedEntries,
  printedItems,
  questionLabel,
  tableBlankNumbers,
} from '../pdf/layout'
import { mm } from '../pdf/styles'
import { buildPuzzle } from '../puzzle/index'
import type { Block } from '../schema/blocks'
import { puzzleInstructions, type PuzzleContent } from '../schema/puzzle'
import type { Question } from '../schema/question'
import { DEFAULT_THEME, resolveQuestionStyle, type TemplateConfig } from '../schema/template'
import { answerLines, totalPoints, type RenderableTest, type ResolvedTestItem } from '../schema/test'
import { image, imageSize, packDocument, pageBreak, paragraph, run, table, type Cell, type EmbeddedImage } from './ooxml'

/**
 * The test as a Word document the teacher can keep editing.
 *
 * It is built from the same data and the same helpers as the PDF
 * (`pdf/layout.ts`), but it is not a copy of the PDF page: everything is a
 * real paragraph or table, so text can be rewritten and questions moved.
 * What only makes sense as a drawing — margin decorations, number badges,
 * rounded corners, the footer — is left out, and Word paginates on its own.
 *
 * Always the blank pupil version: `filled` and `withKey` are ignored.
 */

/** Fonts every school computer has, standing in for the ones bundled for the PDF. */
const WORD_FONT = { NotoSans: 'Arial', NotoSerif: 'Times New Roman' } as const

const GREY = '#555555'
const SOFT = '#333333'
const RULE = '#999999'
const SMALL = 9
/** A cryptogram box with no row assigned — printed pre-filled. */
const GIVEN_BACKGROUND = '#f0f0f0'
/** Drawing space is one table row, and a row taller than a page cannot be laid out. */
const DRAW_SPACE_MAX = 700

interface Context {
  config: TemplateConfig
  variant: 'A' | 'B'
  /** Width of the text column in points. */
  width: number
  assets: Record<string, string>
  /** Images used so far; `picture` adds to it and the package stores them. */
  media: EmbeddedImage[]
}

export async function renderTestToDocx({ test, template, items, variant, assets }: RenderableTest): Promise<Buffer> {
  const config = template.config
  const { page } = config
  const ctx: Context = {
    config,
    variant,
    width: PAGE_WIDTH - mm(page.marginLeftMm) - mm(page.marginRightMm),
    assets,
    media: [],
  }
  // The letter belongs to the title only when there is something to tell apart.
  const title =
    test.variants === 2 || variant === 'B' ? t('pdf:header.variantTitle', { title: test.title, variant }) : test.title
  const heading = { title: test.title, description: test.description }

  let questionIndex = -1
  const body = printedItems(items, variant, test).flatMap((item) => {
    if (item.kind === 'question' && item.question) {
      questionIndex += 1
      return questionView(ctx, item, item.question, questionIndex, test.graded)
    }
    if (item.kind === 'puzzle' && item.puzzle) return puzzleView(ctx, item.puzzle, heading)
    return blockItem(ctx, item)
  })

  return packDocument([...(config.header.show ? header(ctx, test, title, totalPoints(items)) : []), ...body].join(''), {
    margins: {
      top: mm(page.marginTopMm),
      right: mm(page.marginRightMm),
      bottom: mm(page.marginBottomMm),
      left: mm(page.marginLeftMm),
    },
    font: WORD_FONT[page.fontFamily],
    fontSize: page.fontSize,
    lineHeight: page.lineHeight,
    images: ctx.media,
  })
}

/** A little empty space — also what keeps two tables from merging into one. */
const gap = (height: number): string => paragraph('', { exactLine: height })

/**
 * Content in a frame and/or on a fill. A one-cell table rather than a framed
 * paragraph: paragraph frames and fills are drawn by Word, but not by every
 * program a teacher may open the file in — a white heading on a missing fill
 * would simply vanish.
 */
const boxed = (ctx: Context, content: string, style: { frame?: string; fill?: string }): string =>
  table([[{ content, shade: style.fill, border: style.frame ? 'thin' : 'none' }]], {
    widths: [ctx.width],
    border: 'none',
    color: style.frame,
    padding: 4,
  })

const evenWidths = (width: number, columns: number): number[] => Array.from({ length: columns }, () => width / columns)

/**
 * About how many characters fit one line of the text column. Lines to write on
 * are underscores — the one thing every program that opens a `.docx` shows the
 * same — and this keeps them from spilling onto a second line.
 */
const lineLength = (ctx: Context): number => Math.floor(ctx.width / (ctx.config.page.fontSize * 0.6))

/** `label` followed by a line to write on, up to about the right margin. */
const writeLine = (ctx: Context, label: string): string =>
  `${label}\u00A0${'_'.repeat(Math.max(10, lineLength(ctx) - label.length - 1))}`

function header(ctx: Context, test: RenderableTest['test'], title: string, total: number): string[] {
  const { header: style, theme } = ctx.config
  const values: Record<string, string> = {
    school: test.header.school,
    subject: test.header.subject,
    class: test.header.className,
    teacher: test.header.teacher,
    date: test.header.date,
    name: '',
    note: test.header.note,
  }
  // A field without a value is a line to write on, about as long as its share
  // of the row; the label holds on to it so they never part at a line end.
  const fields = style.fields.map((field) => {
    const value = field.value || values[field.key] || ''
    const share = Math.round((lineLength(ctx) * field.widthPercent) / 100)
    const line = '_'.repeat(Math.max(6, share - field.label.length - 4))
    return `${field.label}:\u00A0${value || line}`
  })
  return [
    style.title.show
      ? paragraph(
          run(style.title.uppercase ? title.toUpperCase() : title, {
            bold: true,
            size: style.title.fontSize,
            color: theme.accent,
          }),
          { align: style.title.align, after: 8 },
        )
      : '',
    style.title.show && style.scoreBox && test.graded
      ? paragraph(run(`${t('pdf:header.points', { total })}    ${t('pdf:header.grade')}`, { size: 8 }), {
          align: 'right',
          after: 6,
        })
      : '',
    test.description ? paragraph(run(test.description, { italic: true, color: SOFT }), { after: 6 }) : '',
    test.header.teacher ? paragraph(run(t('pdf:header.teacher', { name: test.header.teacher })), { after: 6 }) : '',
    fields.length > 0 ? paragraph(run(fields.join('   ')), { after: 6 }) : '',
    test.header.note
      ? paragraph(run(t('pdf:header.note', { note: test.header.note }), { italic: true, color: SOFT }), { after: 6 })
      : '',
    style.rule ? paragraph('', { exactLine: 4, rule: theme.accent }) : '',
  ]
}

/** Heading, instruction, worksheet text or table, page break. */
function blockItem(ctx: Context, item: ResolvedTestItem): string[] {
  const { sectionStyle, theme, funFact } = ctx.config
  const text = item.text ?? ''
  switch (item.kind) {
    case 'heading': {
      const title = (color: string) =>
        run(sectionStyle.uppercase ? text.toUpperCase() : text, { bold: true, size: sectionStyle.fontSize, color })
      // A playful worksheet: the heading is a band in the accent colour.
      if (theme.sectionBanner) {
        return [gap(sectionStyle.spacingBefore), boxed(ctx, paragraph(title('#ffffff')), { fill: theme.accent }), gap(4)]
      }
      return [
        paragraph(title(theme.accent), {
          before: sectionStyle.spacingBefore,
          after: 4,
          keepNext: true,
          rule: sectionStyle.rule ? theme.accent : undefined,
        }),
      ]
    }
    case 'instruction':
      return [paragraph(run(text, { italic: true, color: SOFT }), { before: 8 })]
    case 'text': {
      if ((item.textContent?.variant ?? 'text') === 'text') return [paragraph(run(text), { before: L.textSpacing })]
      // A themed template frames the fun fact in its accent; a plain one keeps the grey box.
      const themed = theme.accent !== DEFAULT_THEME.accent
      return [
        gap(L.blockSpacing),
        boxed(
          ctx,
          (funFact.label ? paragraph(run(funFact.label, { bold: true, color: themed ? theme.accent : undefined })) : '') +
            paragraph(run(text)),
          {
            frame: funFact.border ? (themed ? theme.accent : '#444444') : undefined,
            fill: funFact.shaded ? theme.accentSoft : undefined,
          },
        ),
      ]
    }
    case 'table': {
      // A broken table is skipped; the editor shows it as invalid.
      if (!item.table) return []
      const { caption, header: titles, rows } = item.table
      return [
        caption
          ? paragraph(run(caption, { bold: true }), { before: L.blockSpacing, keepNext: true })
          : gap(L.blockSpacing),
        table(
          [
            titles.map((title) => ({ content: paragraph(run(title, { bold: true })), shade: theme.accentSoft })),
            ...rows.map((row) => row.map((cell) => ({ content: cell.blank ? '' : paragraph(run(cell.value)) }))),
          ],
          { widths: evenWidths(ctx.width, titles.length), rowHeight: L.rowMinHeight, padding: L.cellPadding },
        ),
      ]
    }
    case 'page_break':
      return [pageBreak()]
    default:
      return []
  }
}

function questionView(ctx: Context, item: ResolvedTestItem, question: Question, index: number, graded: boolean): string[] {
  const { config } = ctx
  const label = questionLabel(index, config.numbering)
  const points = item.pointsOverride ?? question.points
  const prompt = (question.payload as { prompt?: string }).prompt ?? ''
  return [
    paragraph(
      [
        label ? run(`${label} `, { bold: true }) : '',
        run(prompt, { bold: true }),
        config.showPoints && graded
          ? run(` ${t('pdf:points', { points: formatPoints(points) })}`, { size: 8, color: GREY })
          : '',
      ],
      { before: resolveQuestionStyle(config, question.type).spacingBefore, keepNext: true },
    ),
    ...question.blocks.flatMap((block) => attachment(ctx, block)),
    ...answerArea(ctx, item, question),
  ]
}

/** An image `widthPercent` of the column wide, or a visible notice when it cannot be shown. */
function picture(ctx: Context, assetId: string, widthPercent: number): string {
  const source = /^data:image\/(png|jpeg|gif);base64,(.+)$/.exec(ctx.assets[assetId] ?? '')
  const size = source ? imageSize(Buffer.from(source[2]!, 'base64')) : null
  if (!source || !size) {
    return paragraph(run(t('pdf:question.imageMissing'), { size: SMALL, color: '#aa3333' }), { before: 6 })
  }
  const scale = Math.min((ctx.width * widthPercent) / 100 / size.width, IMAGE_MAX_HEIGHT / size.height)
  ctx.media.push({ extension: source[1]!, base64: source[2]! })
  return paragraph(image(ctx.media.length, size.width * scale, size.height * scale), { before: 6, line: 1 })
}

/** Image or table between the prompt and the answer space. */
function attachment(ctx: Context, block: Block): string[] {
  if (block.kind === 'image') {
    return [
      picture(ctx, block.assetId, block.widthPercent),
      block.caption ? paragraph(run(block.caption, { size: 8, color: GREY })) : '',
    ]
  }
  const columns = Math.max(...block.rows.map((row) => row.reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0)))
  return [
    block.caption ? paragraph(run(block.caption, { size: SMALL }), { before: 6, keepNext: true }) : gap(6),
    table(
      block.rows.map((row) =>
        row.map((cell) => ({
          content: cell.blank ? '' : paragraph(run(cell.text, { bold: cell.header })),
          span: cell.colSpan,
          shade: cell.header ? ctx.config.theme.accentSoft : undefined,
        })),
      ),
      { widths: evenWidths(ctx.width, columns), rowHeight: 16, padding: 4 },
    ),
  ]
}

/** Width of the box a letter or a number is written into (matching, ordering). */
const ANSWER_BOX = 22

/** Short hint on what goes into the boxes of matching and ordering. */
const hint = (text: string): string => paragraph(run(text, { size: 8, color: GREY }), { before: 6, after: 4 })

/** Everything below the prompt: lines, options, tables — the space for the answer. */
function answerArea(ctx: Context, item: ResolvedTestItem, question: Question): string[] {
  const { config, width } = ctx
  const style = resolveQuestionStyle(config, question.type)
  const shade = config.theme.accentSoft
  const bold = (text: string, align?: 'center') => paragraph(run(text, { bold: true }), { align })

  switch (question.type) {
    case 'open':
      // Ruled lines are table rows with a bottom edge: they keep their height
      // and the teacher can still type a sample answer onto them.
      return [
        gap(6),
        table(
          Array.from({ length: answerLines(question, item.linesOverride ?? null) }, () => [{}]),
          { widths: [width], border: 'bottom', rowHeight: style.answerLineHeight, padding: 0 },
        ),
      ]

    case 'draw':
      // Empty space without lines — a frameless table row, whose height holds everywhere.
      return [
        gap(6),
        table([[{}]], {
          widths: [width],
          border: 'none',
          rowHeight: Math.min(DRAW_SPACE_MAX, answerLines(question, item.linesOverride ?? null) * style.answerLineHeight),
        }),
      ]

    case 'short_answer':
      return [paragraph(run(writeLine(ctx, t('pdf:question.answerLabel'))), { before: 6 })]

    case 'single_choice':
    case 'multi_choice': {
      const options = question.payload.options.map((option, i) =>
        paragraph(run(`${question.type === 'multi_choice' ? '☐' : `${LETTERS[i] ?? i + 1})`} ${option}`), { before: 4 }),
      )
      if (style.optionColumns === 1) return options
      const rows: Cell[][] = []
      for (let i = 0; i < options.length; i += 2) rows.push([{ content: options[i] }, { content: options[i + 1] }])
      return [gap(2), table(rows, { widths: evenWidths(width, 2), border: 'none' })]
    }

    case 'true_false': {
      const mark = 44
      return [
        gap(6),
        table(
          [
            [
              { content: bold(t('pdf:question.statement')), shade },
              { content: bold(t('pdf:yes'), 'center'), shade },
              { content: bold(t('pdf:no'), 'center'), shade },
            ],
            // The statement number is in the key too — without it the teacher would count rows while grading.
            ...question.payload.statements.map((statement, i) => [
              { content: paragraph(run(`${i + 1}. ${statement.text}`)) },
              {},
              {},
            ]),
          ],
          { widths: [width - 2 * mark, mark, mark], padding: 4 },
        ),
      ]
    }

    case 'fill_blank':
      return [
        paragraph(run(numberedBlanks(question.payload.text)), { before: 6, line: 1.9 }),
        ...(question.payload.wordBank.length > 0
          ? [
              gap(6),
              boxed(
                ctx,
                paragraph(run(t('pdf:question.wordBank', { words: question.payload.wordBank.join(' • ') }), { size: SMALL })),
                { frame: RULE },
              ),
            ]
          : []),
      ]

    case 'matching': {
      const { left, right } = question.payload
      const half = (width - ANSWER_BOX) / 2
      return [
        hint(t('pdf:question.matchingHint')),
        table(
          Array.from({ length: Math.max(left.length, right.length) }, (_, i) => [
            { border: i < left.length ? ('thin' as const) : undefined },
            { content: i < left.length ? paragraph(run(`${i + 1}. ${left[i]}`)) : '' },
            { content: i < right.length ? paragraph(run(`${LETTERS[i] ?? i + 1}) ${right[i]}`)) : '' },
          ]),
          { widths: [ANSWER_BOX, half, half], border: 'none', rowHeight: 18, padding: 4 },
        ),
      ]
    }

    case 'ordering':
      return [
        hint(t('pdf:question.orderingHint')),
        table(
          displayOrder(question, ctx.variant).map((source) => [
            { border: 'thin' as const },
            { content: paragraph(run(question.payload.items[source] ?? '')) },
          ]),
          { widths: [ANSWER_BOX, width - ANSWER_BOX], border: 'none', rowHeight: 18, padding: 4 },
        ),
      ]

    case 'table_fill': {
      // Empty cells are numbered in the order of their answers in the key.
      const numbers = tableBlankNumbers(question.payload.rows)
      return [
        gap(6),
        table(
          [
            question.payload.headers.map((title) => ({ content: bold(title), shade })),
            ...question.payload.rows.map((row, r) =>
              row.map((cell, c) => ({
                content: paragraph(cell ? run(cell) : run(`(${numbers[r]?.[c]})`, { color: '#777777' })),
              })),
            ),
          ],
          { widths: evenWidths(width, question.payload.headers.length), rowHeight: 18, padding: 4 },
        ),
      ]
    }

    case 'label_image':
      return [
        picture(ctx, question.payload.assetId, 70),
        ...question.payload.labels.map((_, i) => paragraph(run(writeLine(ctx, `${i + 1}.`)), { before: 4 })),
      ]

    default:
      return []
  }
}

/** One box of a letter grid; `null` is an empty frameless place. */
type Box = { text: string; border?: 'thick' | 'none'; shade?: string } | null

/** Letter boxes as a centred table of square cells — word search grid, cryptogram rows. */
function boxGrid(rows: Box[][], size: number): string {
  const columns = Math.max(...rows.map((row) => row.length), 1)
  return table(
    rows.map((row) =>
      Array.from({ length: columns }, (_, c): Cell => {
        const box = row[c]
        if (!box) return { border: 'none' }
        return {
          content: paragraph(run(box.text, { size: size * 0.58 }), { align: 'center', line: 1 }),
          border: box.border ?? 'thin',
          shade: box.shade,
        }
      }),
    ),
    { widths: evenWidths(size * columns, columns), rowHeight: size, exactHeight: true, padding: 0, centered: true },
  )
}

/**
 * A puzzle. The grid is never built here — it comes ready-made from
 * `puzzle/`, the same computation the PDF and the on-screen preview use.
 */
function puzzleView(ctx: Context, puzzle: PuzzleContent, heading: { title: string; description: string | null }): string[] {
  const { config } = ctx
  // The puzzle does not repeat what the header already says.
  const shown = puzzleHeadShown(puzzle, config, heading)
  const built = buildPuzzle(puzzle)
  const label = (text: string) => paragraph(run(text, { size: SMALL }), { before: 8, after: 3, keepNext: true })
  const head = [
    shown.title
      ? paragraph(run(puzzle.title, { bold: true, size: config.sectionStyle.fontSize }), {
          before: config.sectionStyle.spacingBefore,
          keepNext: true,
        })
      : '',
    shown.instructions
      ? paragraph(run(puzzleInstructions(puzzle), { italic: true, color: SOFT }), { keepNext: true })
      : '',
  ]

  if (built.kind === 'wordsearch') {
    const { grid, cols } = built.wordSearch
    const showClues = puzzle.kind === 'wordsearch' && puzzle.payload.showClues
    const words = placedEntries(puzzle, built).map((entry) =>
      paragraph(run(`${entry.word.toUpperCase()}${showClues ? ` – ${entry.clue}` : ''}`, { size: SMALL })),
    )
    const wordRows: Cell[][] = []
    for (let i = 0; i < words.length; i += WORD_LIST_COLUMNS) {
      wordRows.push(Array.from({ length: WORD_LIST_COLUMNS }, (_, c) => ({ content: words[i + c] })))
    }
    return [
      ...head,
      gap(6),
      boxGrid(
        grid.map((row) => row.map((letter) => ({ text: letter }))),
        cellSize(cols),
      ),
      gap(8),
      table(wordRows, { widths: evenWidths(ctx.width, WORD_LIST_COLUMNS), border: 'none' }),
    ]
  }

  const result = built.cryptogram
  const { offsets, boxSize } = cryptogramLayout(result)
  // Phrase boxes wrap by whole words, like on the PDF page.
  const perLine = Math.floor(PUZZLE_USABLE_WIDTH / boxSize)
  const phrase: Box[][] = [[]]
  for (const word of cryptogramPhraseCells(result)) {
    let line = phrase[phrase.length - 1]!
    if (line.length > 0 && line.length + 1 + word.length > perLine) phrase.push((line = []))
    if (line.length > 0) line.push(null)
    line.push(
      ...word.map((cell) => (cell.row ? { text: '' } : { text: cell.letter, shade: GIVEN_BACKGROUND })),
    )
  }
  return [
    ...head,
    label(t('pdf:puzzle.phrase')),
    boxGrid(phrase, boxSize),
    label(t('pdf:puzzle.crossword')),
    boxGrid(
      result.rows.map((row, r) => [
        { text: `${row.number}.`, border: 'none' as const },
        // The offset lines the marked boxes up in one column.
        ...Array.from({ length: offsets[r] ?? 0 }, () => null),
        ...row.letters.map((_, i) => ({ text: '', border: i === row.markedIndex ? ('thick' as const) : undefined })),
      ]),
      boxSize,
    ),
    label(t('pdf:puzzle.clues')),
    ...result.rows.map((row) => paragraph(run(`${row.number}. ${row.clue}`, { size: SMALL }), { after: 3 })),
  ]
}
