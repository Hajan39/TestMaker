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
