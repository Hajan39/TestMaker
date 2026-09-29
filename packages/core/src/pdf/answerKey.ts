import type { Question } from '../schema/question'
import { LETTERS } from './styles'
import { displayOrder } from './shuffle'

/** Textová podoba správné odpovědi pro klíč učitele. */
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
        .map((s, i) => `${i + 1}. ${s.isTrue ? 'ANO' : 'NE'}`)
        .join(', ')

    case 'fill_blank':
      // Závorkované číslo je i v zadání u příslušné mezery (viz QuestionBody).
      return question.payload.blanks.map((b, i) => `(${i + 1}) ${b}`).join(', ')

    case 'matching':
      return question.payload.pairs
        .map(([l, r]) => `${l + 1} – ${LETTERS[r] ?? r + 1}`)
        .join(', ')

    case 'ordering': {
      // V testu jsou položky zamíchané; klíč uvádí, jaké číslo patří ke které řádce.
      const order = displayOrder(question, variant)
      return order
        .map((sourceIndex, displayIndex) => `${displayIndex + 1}. řádek → ${sourceIndex + 1}`)
        .join(', ')
    }

    case 'table_fill':
      // Číslo odpovídá značce v prázdné buňce tabulky v zadání.
      return question.payload.answers.map((a, i) => `(${i + 1}) ${a}`).join(', ')

    case 'label_image':
      return question.payload.labels.map((l, i) => `${i + 1}. ${l}`).join(', ')

    default:
      return ''
  }
}
