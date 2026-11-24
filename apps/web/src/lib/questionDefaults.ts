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

/** Shape of a payload value: `string`, `number`, `array:string`, `array:object`… */
function shape(value: unknown): string {
  return Array.isArray(value) ? `array:${shape(value[0] ?? '')}` : typeof value
}

/**
 * Payload for a type the teacher switched to in the editor. Starts from what
 * that type held before (`earlier`) or its empty payload, and carries over
 * every field the new type shares with the old one in the same shape — the
 * prompt always, options between choice types, the answer between open types.
 * Fields still at the old type's default are not carried, so a default prompt
 * like "Doplň chybějící slova." does not leak into another type.
 */
export function switchPayload(
  from: QuestionType,
  payload: Record<string, unknown>,
  to: QuestionType,
  earlier?: Record<string, unknown>,
): Record<string, unknown> {
  const base = earlier ?? emptyPayload(to)
  const defaults = emptyPayload(from)
  const next = { ...base }
  for (const key of Object.keys(base)) {
    const value = payload[key]
    if (value === undefined || shape(value) !== shape(base[key])) continue
    if (JSON.stringify(value) === JSON.stringify(defaults[key])) continue
    next[key] = value
  }
  return next
}
