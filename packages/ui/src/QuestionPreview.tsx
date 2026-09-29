import type { Question, QuestionContent } from '@testmaker/core/schema'
import { QUESTION_TYPE_LABELS } from '@testmaker/core/schema'
import { Badge } from './ui/badge'
import { cn } from './cn'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

const DIFFICULTY_LABELS = ['', 'lehká', 'střední', 'těžká']

/** Náhled otázky v aplikaci — vizuálně blízko tomu, co vyjde do PDF. */
export function QuestionPreview({
  question,
  showAnswers = true,
  showStatus = false,
  className,
}: {
  question: Question | QuestionContent
  showAnswers?: boolean
  /** Odznak stavu (schváleno/koncept/zamítnuto) — jen tam, kde stav ještě
   *  něco rozhoduje (fronta ke kontrole). Jinde by jen zabíral místo, protože
   *  otázka v tématu i v bance je vždy použitelná. */
  showStatus?: boolean
  className?: string
}) {
  const payload = question.payload as { prompt?: string; text?: string }
  return (
    <div className={cn('text-sm', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{QUESTION_TYPE_LABELS[question.type]}</Badge>
        <Badge variant="secondary">{question.points} b.</Badge>
        <Badge variant="secondary">{DIFFICULTY_LABELS[question.difficulty]}</Badge>
        {/* Stav, ne akce: značková zelená patří tlačítkům. Odznak se navíc
            ukazuje jen tam, kde `showStatus` řekne, že stav ještě rozhoduje
            (fronta ke kontrole) — jinde je otázka vždy použitelná a odznak by
            jen zabíral místo. */}
        {showStatus && 'status' in question && question.status === 'approved' ? (
          <Badge variant="status">schváleno</Badge>
        ) : null}
        {showStatus && 'status' in question && question.status === 'draft' ? (
          <Badge className="bg-draft-bg text-draft-fg">koncept</Badge>
        ) : null}
        {showStatus && 'status' in question && question.status === 'rejected' ? (
          <Badge variant="destructive">zamítnuto</Badge>
        ) : null}
        {'source' in question && question.source === 'manual' ? <Badge variant="secondary">vlastní</Badge> : null}
      </div>
      <p className="mt-2 font-medium text-fg">{payload.prompt ?? payload.text ?? ''}</p>
      <Body question={question} showAnswers={showAnswers} />
      {showAnswers && question.explanation ? (
        <p className="mt-2 text-xs text-fg-muted">Pozn. do klíče: {question.explanation}</p>
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
        <Answer label={`Vzorová odpověď (${question.payload.lines} ř.)`}>{question.payload.answer}</Answer>
      ) : null

    case 'draw':
      return showAnswers ? (
        <Answer label={`Co má kresba obsahovat (${question.payload.lines} ř. místa)`}>{question.payload.answer}</Answer>
      ) : null

    case 'short_answer':
      return showAnswers ? <Answer label="Odpověď">{question.payload.answer}</Answer> : null

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
                  {statement.isTrue ? 'ANO' : 'NE'}
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
            <Answer label="Doplnit">{question.payload.blanks.join(' · ')}</Answer>
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
            <Answer label="Dvojice" className="sm:col-span-2">
              {question.payload.pairs.map(([l, r]) => `${l + 1}–${LETTERS[r]}`).join(', ')}
            </Answer>
          ) : null}
        </div>
      )

    case 'ordering':
      return (
        <ol className="mt-1.5 list-inside list-decimal space-y-0.5 text-fg-soft">
          {question.payload.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
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
          {showAnswers ? <Answer label="Doplnit">{question.payload.answers.join(' · ')}</Answer> : null}
        </div>
      )

    case 'label_image':
      return showAnswers ? <Answer label="Popisky">{question.payload.labels.join(' · ')}</Answer> : null

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
