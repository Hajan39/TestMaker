import type { Question, QuestionContent } from '@testmaker/core/schema'
import { questionTypeLabel } from '@testmaker/core/schema'
import { t } from '@testmaker/core/i18n'
import { displayOrder } from '@testmaker/core/pdf/layout'
import { Badge } from './ui/badge'
import { cn } from './cn'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/** In-app question preview — visually close to what ends up in the PDF. */
export function QuestionPreview({
  question,
  showAnswers = true,
  showStatus = false,
  className,
}: {
  question: Question | QuestionContent
  showAnswers?: boolean
  /** Status badge (approved/draft/rejected) — only where the status still
   *  matters (the review queue). Elsewhere it would just take space, since a
   *  question in a topic or the bank is always usable. */
  showStatus?: boolean
  className?: string
}) {
  const payload = question.payload as { prompt?: string; text?: string }
  return (
    <div className={cn('text-sm', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{questionTypeLabel(question.type)}</Badge>
        <Badge variant="secondary">{t('ui:questionPreview.points', { points: question.points })}</Badge>
        <Badge variant="secondary">{t(`ui:questionPreview.difficulty.${question.difficulty}`)}</Badge>
        {/* A status, not an action: brand green belongs to buttons. The badge is
            also shown only where `showStatus` says the status still matters
            (the review queue) — elsewhere the question is always usable and the
            badge would just take space. */}
        {showStatus && 'status' in question && question.status === 'approved' ? (
          <Badge variant="status">{t('ui:questionPreview.status.approved')}</Badge>
        ) : null}
        {showStatus && 'status' in question && question.status === 'draft' ? (
          <Badge className="bg-draft-bg text-draft-fg">{t('ui:questionPreview.status.draft')}</Badge>
        ) : null}
        {showStatus && 'status' in question && question.status === 'rejected' ? (
          <Badge variant="destructive">{t('ui:questionPreview.status.rejected')}</Badge>
        ) : null}
        {'source' in question && question.source === 'manual' ? <Badge variant="secondary">{t('ui:questionPreview.manual')}</Badge> : null}
      </div>
      <p className="mt-2 font-medium text-fg">{payload.prompt ?? payload.text ?? ''}</p>
      <Body question={question} showAnswers={showAnswers} />
      {showAnswers && question.explanation ? (
        <p className="mt-2 text-xs text-fg-muted">{t('ui:questionPreview.keyNote', { note: question.explanation })}</p>
      ) : null}
    </div>
  )
}

function Body({
  question,
  showAnswers,
}: {
  question: Question | QuestionContent
  showAnswers: boolean
}) {
  switch (question.type) {
    case 'open':
      return showAnswers ? (
        <Answer label={t('ui:questionPreview.modelAnswer', { lines: question.payload.lines })}>{question.payload.answer}</Answer>
      ) : null

    case 'draw':
      return showAnswers ? (
        <Answer label={t('ui:questionPreview.drawingContent', { lines: question.payload.lines })}>{question.payload.answer}</Answer>
      ) : null

    case 'short_answer':
      return showAnswers ? <Answer label={t('ui:questionPreview.answer')}>{question.payload.answer}</Answer> : null

    case 'single_choice':
      return (
        <ul className="mt-1.5 space-y-0.5">
          {question.payload.options.map((option, i) => (
            <li
              key={i}
              className={cn(
                'text-fg-soft',
                showAnswers && i === question.payload.correctIndex && 'font-medium text-brand',
              )}
            >
              {LETTERS[i]}) {option}
            </li>
          ))}
        </ul>
      )

    case 'multi_choice':
      return (
        <ul className="mt-1.5 space-y-0.5">
          {question.payload.options.map((option, i) => (
            <li
              key={i}
              className={cn(
                'text-fg-soft',
                showAnswers && question.payload.correctIndices.includes(i) && 'font-medium text-brand',
              )}
            >
              ☐ {option}
            </li>
          ))}
        </ul>
      )

    case 'true_false':
      return (
        <ul className="mt-1.5 space-y-0.5">
          {question.payload.statements.map((statement, i) => (
            <li key={i} className="text-fg-soft">
              {statement.text}
              {showAnswers ? (
                <span className="ml-2 font-medium text-brand">
                  {statement.isTrue ? t('ui:questionPreview.yes') : t('ui:questionPreview.no')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )

    case 'fill_blank':
      return (
        <div className="mt-1.5 text-fg-soft">
          <p>{question.payload.text}</p>
          {showAnswers ? (
            <Answer label={t('ui:questionPreview.fill')}>{question.payload.blanks.join(' · ')}</Answer>
          ) : null}
        </div>
      )

    case 'matching':
      return (
        <div className="mt-1.5 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
          <ul className="space-y-0.5">
            {question.payload.left.map((item, i) => (
              <li key={i} className="text-fg-soft">
                {i + 1}. {item}
              </li>
            ))}
          </ul>
          <ul className="space-y-0.5">
            {question.payload.right.map((item, i) => (
              <li key={i} className="text-fg-soft">
                {LETTERS[i]}) {item}
              </li>
            ))}
          </ul>
          {showAnswers ? (
            <Answer label={t('ui:questionPreview.pairs')} className="sm:col-span-2">
              {question.payload.pairs.map(([l, r]) => `${l + 1}–${LETTERS[r]}`).join(', ')}
            </Answer>
          ) : null}
        </div>
      )

    case 'ordering':
      // Items in shuffled order as on paper (variant A); with answers each
      // shows its position in the correct order.
      return (
        <ul className="mt-1.5 space-y-0.5 text-fg-soft">
          {displayOrder(question, 'A').map((sourceIndex) => (
            <li key={sourceIndex}>
              {showAnswers ? <span className="mr-1.5 font-medium text-brand">{sourceIndex + 1}.</span> : null}
              {question.payload.items[sourceIndex]}
            </li>
          ))}
        </ul>
      )

    case 'table_fill':
      return (
        <div className="mt-1.5 overflow-x-auto">
          <table className="min-w-full border border-line text-left text-xs">
            <thead className="bg-surface-muted">
              <tr>
                {question.payload.headers.map((header, i) => (
                  <th key={i} className="border border-line px-2 py-1 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {question.payload.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-line px-2 py-1 text-fg-soft">
                      {cell ?? <span className="text-fg-muted">………</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {showAnswers ? <Answer label={t('ui:questionPreview.fill')}>{question.payload.answers.join(' · ')}</Answer> : null}
        </div>
      )

    case 'label_image':
      return showAnswers ? <Answer label={t('ui:questionPreview.labels')}>{question.payload.labels.join(' · ')}</Answer> : null

    default:
      return null
  }
}

function Answer({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <p className={cn('mt-1.5 text-xs text-fg-soft', className)}>
      <span className="font-medium text-fg-muted">{label}: </span>
      {children}
    </p>
  )
}
