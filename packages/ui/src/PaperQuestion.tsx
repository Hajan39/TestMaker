import type { Block } from '@testmaker/core/schema'
import type { Question, QuestionContent, QuestionStyle } from '@testmaker/core/schema'
import { answerLines } from '@testmaker/core/schema'
import { displayOrder, formatPoints, LETTERS, numberedBlanks, tableBlankNumbers } from '@testmaker/core/pdf/layout'
import { t } from '@testmaker/core/i18n'
import { cn } from './cn'

/**
 * A question rendered as it will print — number, prompt, points and below them
 * the real answer area: lines, options A) B) C), a true/false table, two
 * columns for matching, numbered boxes for ordering.
 *
 * Modelled on `QuestionBody.tsx` in `packages/core/src/pdf`: what
 * `@react-pdf/renderer` draws there, the browser draws here. The teacher
 * decides how to compose the test based on this, so the two must not diverge —
 * shared bits (blank numbering, cell markers, option letters) come from
 * `@testmaker/core/pdf/layout` on both sides.
 *
 * Sizes are written in PDF points (pt) via the `--paper-pt` variable, set by
 * `PaperSheet` from the real sheet width. That keeps font, margin and line
 * proportions as on paper, however wide the preview is. Without a sheet (e.g.
 * in tests) the fallback applies, roughly 1 pt = 1.33 px.
 *
 * The answer key is never drawn here: this is the view of what pupils get.
 * The composer shows the model answer separately, above the paper.
 */

/** Size in PDF points; `--paper-pt` is set by the sheet, otherwise 96/72 px. */
const pt = (value: number): string => `calc(${value} * var(--paper-pt, 1.3333px))`

/** Default question style — the same values as `questionStyleSchema` in core. */
const DEFAULT_STYLE: QuestionStyle = {
  spacingBefore: 10,
  optionColumns: 1,
  answerLineHeight: 20,
  boxed: false,
}

/** Fixed placeholder image height; matches the estimate in `pdf/estimate.ts`. */
const IMAGE_PLACEHOLDER_HEIGHT = 110

export function PaperQuestion({
  question,
  label,
  points,
  lines,
  style,
  variant = 'A',
  className,
}: {
  question: Question | QuestionContent
  /** Question number as printed ("3."). Empty = no number. */
  label?: string
  /** Points next to the prompt; `null` = ungraded test, points are not printed. */
  points?: number | null
  /** Override of the answer line count for an open answer. */
  lines?: number | null
  /** Style from the template; missing values fall back to defaults. */
  style?: Partial<QuestionStyle>
  variant?: 'A' | 'B'
  className?: string
}) {
  const resolved: QuestionStyle = { ...DEFAULT_STYLE, ...style }
  const prompt = (question.payload as { prompt?: string }).prompt ?? ''

  return (
    <div
      className={cn('text-paper-fg', className)}
      style={{
        marginTop: pt(resolved.spacingBefore),
        border: resolved.boxed ? `1px solid var(--color-paper-line)` : undefined,
        padding: resolved.boxed ? pt(6) : undefined,
      }}
    >
      <div className="flex items-start">
        {label ? <span className="font-bold" style={{ marginRight: pt(5) }}>{label}</span> : null}
        <span className="min-w-0 flex-1 font-bold break-words">{prompt}</span>
        {points != null ? (
          <span className="shrink-0 opacity-70" style={{ fontSize: pt(8), marginLeft: pt(6) }}>
            {t('ui:paper.question.points', { points: formatPoints(points) })}
          </span>
        ) : null}
      </div>
      {question.blocks.map((block, i) => (
        <PaperBlock key={i} block={block} />
      ))}
      <PaperAnswerArea question={question} style={resolved} lines={lines} variant={variant} />
    </div>
  )
}

/** A question attachment: a table is rendered, an image is replaced by a captioned frame. */
function PaperBlock({ block }: { block: Block }) {
  if (block.kind === 'image') {
    return (
      <div style={{ marginTop: pt(6), marginBottom: pt(4), width: `${block.widthPercent}%` }}>
        {/* Attachments are not downloaded to the browser (they are large and the
            preview redraws on every edit) — a frame of the same height holds the place. */}
        <div
          className="flex items-center justify-center border border-paper-line opacity-70"
          style={{ height: pt(IMAGE_PLACEHOLDER_HEIGHT), fontSize: pt(8) }}
        >
          {t('ui:paper.question.image')}
        </div>
        {block.caption ? (
          <p className="opacity-70" style={{ fontSize: pt(8), marginTop: pt(2) }}>{block.caption}</p>
        ) : null}
      </div>
    )
  }
  return (
    <div style={{ marginTop: pt(6), marginBottom: pt(4) }}>
      {block.caption ? <p style={{ fontSize: pt(9), marginBottom: pt(2) }}>{block.caption}</p> : null}
      <table className="w-full table-fixed border-collapse border border-paper-line">
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  colSpan={cell.colSpan ?? 1}
                  className={cn(
                    'border border-paper-line align-top break-words',
                    cell.header && 'bg-paper-shade font-bold',
                  )}
                  style={{ padding: pt(4) }}
                >
                  {cell.blank ? '' : cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaperAnswerArea({
  question,
  style,
  lines,
  variant,
}: {
  question: Question | QuestionContent
  style: QuestionStyle
  lines: number | null | undefined
  variant: 'A' | 'B'
}) {
  switch (question.type) {
    case 'open':
      return (
        <div style={{ marginTop: pt(6) }}>
          {Array.from({ length: answerLines(question, lines ?? null) }, (_, i) => (
            <div
              key={i}
              data-slot="paper-line"
              className="border-b border-paper-line"
              style={{ height: pt(style.answerLineHeight) }}
            />
          ))}
        </div>
      )

    case 'draw':
      return (
        <div
          data-slot="paper-draw"
          style={{ marginTop: pt(6), height: pt(answerLines(question, lines ?? null) * style.answerLineHeight) }}
        />
      )

    case 'short_answer':
      return (
        <div className="flex items-end" style={{ marginTop: pt(6) }}>
          <span>{t('ui:paper.question.answer')}</span>
          <span
            className="flex-1 border-b border-paper-line"
            style={{ marginLeft: pt(6), height: pt(14) }}
          />
        </div>
      )

    case 'single_choice':
    case 'multi_choice': {
      const marker = question.type === 'single_choice' ? 'letter' : 'box'
      return (
        <ol className="flex flex-wrap" style={{ marginTop: pt(2) }}>
          {question.payload.options.map((option, i) => (
            <li
              key={i}
              className="flex items-start"
              style={{
                marginTop: pt(4),
                width: style.optionColumns === 2 ? '50%' : '100%',
                paddingRight: style.optionColumns === 2 ? pt(8) : undefined,
              }}
            >
              {marker === 'box' ? (
                <span
                  aria-hidden="true"
                  className="shrink-0 border border-paper-fg"
                  style={{ width: pt(9), height: pt(9), marginRight: pt(6), marginTop: pt(1.5) }}
                />
              ) : (
                <span className="shrink-0" style={{ marginRight: pt(4) }}>{LETTERS[i] ?? i + 1})</span>
              )}
              <span className="min-w-0 flex-1 break-words">{option}</span>
            </li>
          ))}
        </ol>
      )
    }

    case 'true_false':
      return (
        <table
          className="w-full table-fixed border-collapse border border-paper-line"
          style={{ marginTop: pt(6) }}
        >
          <thead>
            <tr className="bg-paper-shade">
              <th className="border border-paper-line text-left font-bold" style={{ padding: pt(4) }}>
                {t('ui:paper.question.statement')}
              </th>
              <th className="border border-paper-line font-bold" style={{ padding: pt(4), width: pt(44) }}>
                {t('ui:paper.question.yes')}
              </th>
              <th className="border border-paper-line font-bold" style={{ padding: pt(4), width: pt(44) }}>
                {t('ui:paper.question.no')}
              </th>
            </tr>
          </thead>
          <tbody>
            {question.payload.statements.map((statement, i) => (
              <tr key={i}>
                {/* The statement number is in the key too — without it the teacher would count rows while marking. */}
                <td className="border border-paper-line break-words" style={{ padding: pt(4) }}>
                  {i + 1}. {statement.text}
                </td>
                <td className="border border-paper-line" />
                <td className="border border-paper-line" />
              </tr>
            ))}
          </tbody>
        </table>
      )

    case 'fill_blank':
      return (
        <div style={{ marginTop: pt(6) }}>
          <p className="break-words" style={{ lineHeight: 1.9 }}>
            {numberedBlanks(question.payload.text)}
          </p>
          {question.payload.wordBank.length > 0 ? (
            <div
              className="border border-paper-line break-words"
              style={{ marginTop: pt(6), padding: pt(5), fontSize: pt(9) }}
            >
              {t('ui:paper.question.wordBank', { words: question.payload.wordBank.join(' • ') })}
            </div>
          ) : null}
        </div>
      )

    case 'matching':
      return (
        <div style={{ marginTop: pt(6) }}>
          <PaperHint text={t('ui:paper.question.matchingHint')} />
          <div className="flex">
            <ol className="min-w-0 flex-1" style={{ paddingRight: pt(8) }}>
              {question.payload.left.map((item, i) => (
                <li key={i} className="flex items-start" style={{ marginBottom: pt(5) }}>
                  <span
                    aria-hidden="true"
                    className="shrink-0 border border-paper-fg"
                    style={{ width: pt(22), height: pt(14), marginRight: pt(6) }}
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {i + 1}. {item}
                  </span>
                </li>
              ))}
            </ol>
            <ol className="min-w-0 flex-1 border-l border-paper-line" style={{ paddingLeft: pt(8) }}>
              {question.payload.right.map((item, i) => (
                <li key={i} className="break-words" style={{ marginBottom: pt(5) }}>
                  {LETTERS[i] ?? i + 1}) {item}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )

    case 'ordering': {
      // Items are shuffled on paper; printing computes the same order.
      const order = displayOrder(question, variant)
      return (
        <div style={{ marginTop: pt(6) }}>
          <PaperHint text={t('ui:paper.question.orderingHint')} />
          <ol>
            {order.map((sourceIndex, i) => (
              <li key={i} className="flex items-start" style={{ marginBottom: pt(5) }}>
                <span
                  aria-hidden="true"
                  className="shrink-0 border border-paper-fg"
                  style={{ width: pt(22), height: pt(14), marginRight: pt(6) }}
                />
                <span className="min-w-0 flex-1 break-words">{question.payload.items[sourceIndex] ?? ''}</span>
              </li>
            ))}
          </ol>
        </div>
      )
    }

    case 'table_fill': {
      const blankNumbers = tableBlankNumbers(question.payload.rows)
      return (
        <table
          className="w-full table-fixed border-collapse border border-paper-line"
          style={{ marginTop: pt(6) }}
        >
          <thead>
            <tr className="bg-paper-shade">
              {question.payload.headers.map((header, i) => (
                <th
                  key={i}
                  className="border border-paper-line text-left font-bold break-words"
                  style={{ padding: pt(4) }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {question.payload.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn('border border-paper-line align-top break-words', !cell && 'opacity-70')}
                    style={{ padding: pt(4) }}
                  >
                    {cell ?? `(${blankNumbers[r]?.[c]})`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    case 'label_image':
      return (
        <div style={{ marginTop: pt(6) }}>
          <div
            className="flex w-[70%] items-center justify-center border border-paper-line opacity-70"
            style={{ height: pt(IMAGE_PLACEHOLDER_HEIGHT), fontSize: pt(8) }}
          >
            {t('ui:paper.question.imageToLabel')}
          </div>
          <ol>
            {question.payload.labels.map((_, i) => (
              <li key={i} className="flex items-end" style={{ marginTop: pt(4) }}>
                <span>{i + 1}.</span>
                <span
                  className="flex-1 border-b border-paper-line"
                  style={{ marginLeft: pt(6), height: pt(13) }}
                />
              </li>
            ))}
          </ol>
        </div>
      )

    default:
      return null
  }
}

/**
 * A short instruction on how to fill in the answer — the same text as in the
 * PDF. It belongs to rendering the box symbol, not to the question content.
 */
function PaperHint({ text }: { text: string }) {
  return (
    <p className="opacity-70" style={{ fontSize: pt(8), marginBottom: pt(4) }}>
      {text}
    </p>
  )
}
