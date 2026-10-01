import { t } from '../i18n'
import type { Question } from '../schema/question'
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
