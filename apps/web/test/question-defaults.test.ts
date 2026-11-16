import { describe, expect, it } from 'vitest'
import { emptyPayload, switchPayload } from '@/lib/questionDefaults'

describe('switching the type of a question being written', () => {
  it('keeps the prompt the teacher wrote', () => {
    const next = switchPayload('single_choice', 'short_answer', { ...emptyPayload('single_choice'), prompt: 'Kolik má pavouk nohou?' })
    expect(next).toEqual({ prompt: 'Kolik má pavouk nohou?', answer: '', acceptedAnswers: [] })
  })

  it('replaces a prompt that is only the old type’s default sentence', () => {
    const next = switchPayload('true_false', 'fill_blank', emptyPayload('true_false'))
    expect(next.prompt).toBe(emptyPayload('fill_blank').prompt)
  })

  it('an empty prompt gets the new type’s default', () => {
    expect(switchPayload('short_answer', 'matching', emptyPayload('short_answer')).prompt).toBe(
      emptyPayload('matching').prompt,
    )
  })

  it('choices keep their options and the correct answer', () => {
    const single = { prompt: 'Vyber.', options: ['a', 'b', 'c'], correctIndex: 2 }
    const multi = switchPayload('single_choice', 'multi_choice', single)
    expect(multi).toEqual({ prompt: 'Vyber.', options: ['a', 'b', 'c'], correctIndices: [2] })
    expect(switchPayload('multi_choice', 'single_choice', { ...multi, correctIndices: [1, 2] })).toEqual({
      prompt: 'Vyber.',
      options: ['a', 'b', 'c'],
      correctIndex: 1,
    })
  })

  it('free-answer types keep the answer', () => {
    const next = switchPayload('open', 'short_answer', { prompt: 'Co je to?', lines: 4, answer: 'pavouk' })
    expect(next).toMatchObject({ prompt: 'Co je to?', answer: 'pavouk' })
  })
})
