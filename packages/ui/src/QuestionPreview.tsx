import type { Question, QuestionContent } from '@testmaker/core/schema'
import { QUESTION_TYPE_LABELS } from '@testmaker/core/schema'
import { Badge } from './Surface'
import { cn } from './cn'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

const DIFFICULTY_LABELS = ['', 'lehká', 'střední', 'těžká']

/** Náhled otázky v aplikaci — vizuálně blízko tomu, co vyjde do PDF. */
export function QuestionPreview({
  question,
  showAnswers = true,
  className,
}: {
  question: Question | QuestionContent
  showAnswers?: boolean
  className?: string
}) {
  const payload = question.payload as { prompt?: string; text?: string }
  return (
    <div className={cn('text-sm', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge>{QUESTION_TYPE_LABELS[question.type]}</Badge>
        <Badge tone="neutral">{question.points} b.</Badge>
        <Badge tone="neutral">{DIFFICULTY_LABELS[question.difficulty]}</Badge>
        {'status' in question && question.status === 'approved' ? (
          <Badge tone="brand">schváleno</Badge>
        ) : null}
        {'source' in question && question.source === 'manual' ? <Badge>vlastní</Badge> : null}
      </div>
      <p className="mt-2 font-medium text-ink-900">{payload.prompt ?? payload.text ?? ''}</p>
      <Body question={question} showAnswers={showAnswers} />
      {showAnswers && question.explanation ? (
        <p className="mt-2 text-xs text-ink-500">Pozn. do klíče: {question.explanation}</p>
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

    case 'short_answer':
      return showAnswers ? <Answer label="Odpověď">{question.payload.answer}</Answer> : null

    case 'single_choice':
      return (
        <ul className="mt-1.5 space-y-0.5">
          {question.payload.options.map((option, i) => (
            <li
              key={i}
              className={cn(
                'text-ink-700',
                showAnswers && i === question.payload.correctIndex && 'font-medium text-brand-700',
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
                'text-ink-700',
                showAnswers && question.payload.correctIndices.includes(i) && 'font-medium text-brand-700',
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
            <li key={i} className="text-ink-700">
              {statement.text}
              {showAnswers ? (
                <span className="ml-2 font-medium text-brand-700">
                  {statement.isTrue ? 'ANO' : 'NE'}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )

    case 'fill_blank':
      return (
        <div className="mt-1.5 text-ink-700">
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
              <li key={i} className="text-ink-700">
                {i + 1}. {item}
              </li>
            ))}
          </ul>
          <ul className="space-y-0.5">
            {question.payload.right.map((item, i) => (
              <li key={i} className="text-ink-700">
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
        <ol className="mt-1.5 list-inside list-decimal space-y-0.5 text-ink-700">
          {question.payload.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      )

    case 'table_fill':
      return (
        <div className="mt-1.5 overflow-x-auto">
          <table className="min-w-full border border-ink-200 text-left text-xs">
            <thead className="bg-ink-50">
              <tr>
                {question.payload.headers.map((header, i) => (
                  <th key={i} className="border border-ink-200 px-2 py-1 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {question.payload.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-ink-200 px-2 py-1 text-ink-700">
                      {cell ?? <span className="text-ink-300">………</span>}
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
    <p className={cn('mt-1.5 text-xs text-ink-600', className)}>
      <span className="font-medium text-ink-500">{label}: </span>
      {children}
    </p>
  )
}
