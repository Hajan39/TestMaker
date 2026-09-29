import type { QuestionType } from '@testmaker/core/schema'

/** Prázdný payload pro nově zvolený typ otázky. */
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
        prompt: 'Rozhodni, zda jsou tvrzení pravdivá.',
        statements: [
          { text: '', isTrue: true },
          { text: '', isTrue: false },
        ],
      }
    case 'fill_blank':
      return { prompt: 'Doplň chybějící výrazy.', text: '', blanks: [''], wordBank: [] }
    case 'matching':
      return {
        prompt: 'Přiřaď k sobě odpovídající dvojice.',
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
