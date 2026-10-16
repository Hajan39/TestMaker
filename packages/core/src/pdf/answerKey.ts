import { t } from '../i18n'
import type { Question } from '../schema/question'
import { gradeBoundaries } from '../compose/gradeScale'
import { partialScoring } from '../compose/scoring'
import { formatPoints } from './layout'
import { LETTERS } from './styles'
import { displayOrder } from './shuffle'

/** Text form of the correct answer for the teacher's key. */
export function formatAnswer(question: Question, variant: 'A' | 'B'): string {
  switch (question.type) {
    case 'open':
    case 'draw':
    case 'short_answer':
      return question.payload.answer

    case 'single_choice':
      return `${LETTERS[question.payload.correctIndex] ?? '?'}) ${
        question.payload.options[question.payload.correctIndex] ?? ''
      }`

    case 'multi_choice':
      return question.payload.correctIndices
        .map((i) => `${LETTERS[i] ?? '?'}) ${question.payload.options[i] ?? ''}`)
        .join('; ')

    case 'true_false':
      return question.payload.statements
        .map((s, i) => `${i + 1}. ${s.isTrue ? t('pdf:yes') : t('pdf:no')}`)
        .join(', ')

    case 'fill_blank':
      // The bracketed number also appears next to the blank in the question (see QuestionBody).
      return question.payload.blanks.map((b, i) => `(${i + 1}) ${b}`).join(', ')

    case 'matching':
      return question.payload.pairs
        .map(([l, r]) => `${l + 1} – ${LETTERS[r] ?? r + 1}`)
        .join(', ')

    case 'ordering': {
      // Items are shuffled in the test; the key says which number belongs to which line.
      const order = displayOrder(question, variant)
      return order
        .map((sourceIndex, displayIndex) => t('pdf:answerKey.orderingLine', { line: displayIndex + 1, number: sourceIndex + 1 }))
        .join(', ')
    }

    case 'table_fill':
      // The number matches the mark in the empty table cell of the question.
      return question.payload.answers.map((a, i) => `(${i + 1}) ${a}`).join(', ')

    case 'label_image':
      return question.payload.labels.map((l, i) => `${i + 1}. ${l}`).join(', ')

    default:
      return ''
  }
}

/**
 * Partial-scoring line for the teacher's key, e.g. "bez chyby 3 b. · 1 chyba
 * 2 b. · … · 4 a víc chyb 0 b."; null when the question is scored as a whole.
 */
/**
 * Other accepted answers for the teacher's key ("Uznej také: CO₂, oxid
 * uhličitý"); null when the question has none. Only a short answer carries
 * alternatives — other types have a single expected form.
 */
export function formatAcceptedAnswers(question: Question): string | null {
  if (question.type !== 'short_answer') return null
  const answers = question.payload.acceptedAnswers.map((answer) => answer.trim()).filter(Boolean)
  return answers.length > 0 ? t('pdf:answerKey.alsoAccept', { answers: answers.join(', ') }) : null
}

/**
 * Grade boundaries for the key: "Známky: 1: 45–41 · 2: 40–34 · …";
 * null when the test has no points.
 */
export function formatGradeBoundaries(total: number): string | null {
  const ranges = gradeBoundaries(total)
  if (!ranges) return null
  const list = ranges
    .map(({ grade, from, to }) =>
      from === to
        ? t('pdf:key.gradeSingle', { grade, from: formatPoints(from) })
        : t('pdf:key.gradeRange', { grade, from: formatPoints(from), to: formatPoints(to) }),
    )
    .join(' · ')
  return t('pdf:key.grades', { list })
}

export function formatPartialScoring(question: Question, points: number): string | null {
  const steps = partialScoring(question, points)
  if (!steps) return null
  const last = steps.length - 1
  return steps
    .map((step, i) => {
      const value = formatPoints(step.points)
      if (step.errors === 0) return t('pdf:answerKey.scoring.noError', { points: value })
      if (i === last) return t('pdf:answerKey.scoring.errorsOrMore', { n: step.errors, points: value })
      return t('pdf:answerKey.scoring.errors', { count: step.errors, points: value })
    })
    .join(' · ')
}
