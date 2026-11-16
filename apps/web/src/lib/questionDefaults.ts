import type { QuestionType } from '@testmaker/core/schema'
import { t } from '@testmaker/core/i18n'

/** Empty payload for a newly chosen question type. */
export function emptyPayload(type: QuestionType): Record<string, unknown> {
  switch (type) {
    case 'open':
      return { prompt: '', lines: 4, answer: '' }
    case 'draw':
      return { prompt: '', lines: 8, answer: '' }
    case 'short_answer':
      return { prompt: '', answer: '', acceptedAnswers: [] }
    case 'single_choice':
      return { prompt: '', options: ['', '', '', ''], correctIndex: 0 }
    case 'multi_choice':
      return { prompt: '', options: ['', '', '', ''], correctIndices: [0] }
    case 'true_false':
      return {
        prompt: t('library:questionDefaults.trueFalsePrompt'),
        statements: [
          { text: '', isTrue: true },
          { text: '', isTrue: false },
        ],
      }
    case 'fill_blank':
      return { prompt: t('library:questionDefaults.fillBlankPrompt'), text: '', blanks: [''], wordBank: [] }
    case 'matching':
      return {
        prompt: t('library:questionDefaults.matchingPrompt'),
        left: ['', '', ''],
        right: ['', '', ''],
        pairs: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      }
    case 'ordering':
      return { prompt: '', items: ['', '', ''] }
    case 'table_fill':
      return { prompt: '', headers: ['', ''], rows: [['', null]], answers: [''] }
    case 'label_image':
      return { prompt: '', assetId: '', labels: [''] }
    default:
      return {}
  }
}

const CHOICES = new Set<QuestionType>(['single_choice', 'multi_choice'])
const FREE_ANSWER = new Set<QuestionType>(['open', 'draw', 'short_answer'])

/**
 * Payload after switching the type of a question being written. The prompt
 * stays — a teacher often writes the question first and only then picks the
 * type, and retyping it would be pointless. Choices keep their options and
 * free-answer types their answer; everything else starts empty, because the
 * shapes differ. A prompt that is only the old type's default sentence is
 * replaced by the new type's default.
 */
export function switchPayload(
  from: QuestionType,
  to: QuestionType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const next = emptyPayload(to)
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
  if (prompt.trim() && prompt !== emptyPayload(from).prompt) next.prompt = prompt

  if (CHOICES.has(from) && CHOICES.has(to) && Array.isArray(payload.options)) {
    next.options = payload.options
    const correct =
      from === 'multi_choice'
        ? ((payload.correctIndices as number[] | undefined) ?? [])
        : [Number(payload.correctIndex ?? 0)]
    if (to === 'multi_choice') next.correctIndices = correct.length > 0 ? correct : [0]
    else next.correctIndex = correct[0] ?? 0
  }
  if (FREE_ANSWER.has(from) && FREE_ANSWER.has(to) && typeof payload.answer === 'string') {
    next.answer = payload.answer
  }
  return next
}
