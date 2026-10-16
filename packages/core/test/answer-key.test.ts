import { describe, expect, it } from 'vitest'
import { formatAcceptedAnswers } from '../src/pdf/answerKey'
import { makeQuestion } from './fixtures'

const shortAnswer = (acceptedAnswers: string[]) =>
  makeQuestion({
    type: 'short_answer',
    payload: { prompt: 'Jaký plyn rostliny při fotosyntéze přijímají?', answer: 'oxid uhličitý', acceptedAnswers },
  })

describe('formatAcceptedAnswers', () => {
  it('lists the other accepted answers of a short answer', () => {
    expect(formatAcceptedAnswers(shortAnswer(['CO2', 'kysličník uhličitý']))).toBe('Uznej také: CO2, kysličník uhličitý')
  })

  it('skips blank variants and returns null when none are left', () => {
    expect(formatAcceptedAnswers(shortAnswer([' ', '']))).toBeNull()
    expect(formatAcceptedAnswers(shortAnswer([]))).toBeNull()
  })

  it('returns null for types without alternatives', () => {
    const open = makeQuestion({ type: 'open', payload: { prompt: 'Popiš fotosyntézu.', answer: 'Rostlina…', lines: 4 } })
    expect(formatAcceptedAnswers(open)).toBeNull()
  })
})
