import { describe, expect, it } from 'vitest'
import { emptyPayload, switchPayload } from '@/lib/questionDefaults'

/** Changing the question type in the editor must not throw away what the teacher wrote. */
describe('switchPayload', () => {
  it('keeps the prompt and the model answer when a free answer becomes a short answer', () => {
    const open = { prompt: 'Popiš koloběh vody.', lines: 4, answer: 'Voda se vypaří a spadne jako déšť.' }
    expect(switchPayload('open', open, 'short_answer')).toEqual({
      prompt: 'Popiš koloběh vody.',
      answer: 'Voda se vypaří a spadne jako déšť.',
      acceptedAnswers: [],
    })
  })

  it('keeps the written prompt over the default prompt of the new type', () => {
    const open = { prompt: 'Je voda mokrá?', lines: 4, answer: '' }
    expect(switchPayload('open', open, 'true_false').prompt).toBe('Je voda mokrá?')
  })

  it('does not carry the default prompt of the old type over', () => {
    const untouched = emptyPayload('fill_blank')
    expect(switchPayload('fill_blank', untouched, 'open')).toEqual(emptyPayload('open'))
  })

  it('carries options between single and multiple choice but not into incompatible fields', () => {
    const single = { prompt: 'Které je savec?', options: ['pes', 'kapr', 'sýkora'], correctIndex: 0 }
    expect(switchPayload('single_choice', single, 'multi_choice')).toEqual({
      prompt: 'Které je savec?',
      options: ['pes', 'kapr', 'sýkora'],
      correctIndices: [0],
    })
    // Ordering items are strings too, but a different field — nothing besides the prompt goes over.
    expect(switchPayload('single_choice', single, 'ordering')).toEqual({ prompt: 'Které je savec?', items: ['', '', ''] })
  })

  it('switching back restores the earlier content of that type', () => {
    const open = { prompt: 'Popiš kostru.', lines: 6, answer: 'Lebka, páteř, končetiny.' }
    const choice = switchPayload('open', open, 'single_choice')
    const back = switchPayload('single_choice', { ...choice, prompt: 'Popiš kostru člověka.' }, 'open', open)
    expect(back).toEqual({ prompt: 'Popiš kostru člověka.', lines: 6, answer: 'Lebka, páteř, končetiny.' })
  })
})
