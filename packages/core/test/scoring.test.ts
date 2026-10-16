import { describe, expect, it } from 'vitest'
import { partialScoring } from '../src/compose/scoring'
import { formatPartialScoring } from '../src/pdf/answerKey'
import { makeQuestion } from './fixtures'

const multi = (correct: number) =>
  makeQuestion({
    type: 'multi_choice',
    payload: {
      prompt: 'Vyber správné odpovědi.',
      options: Array.from({ length: Math.max(3, correct + 1) }, (_, i) => `možnost ${i + 1}`),
      correctIndices: Array.from({ length: correct }, (_, i) => i),
    },
  })

const trueFalse = (count: number) =>
  makeQuestion({
    type: 'true_false',
    payload: {
      prompt: 'Rozhodni.',
      statements: Array.from({ length: count }, (_, i) => ({ text: `tvrzení ${i + 1}`, isTrue: i % 2 === 0 })),
    },
  })

const steps = (pairs: [number, number][]) => pairs.map(([errors, points]) => ({ errors, points }))

describe('partialScoring', () => {
  it("follows the owner's example: 4 correct answers worth 3 points", () => {
    expect(partialScoring(multi(4), 3)).toEqual(steps([[0, 3], [1, 2], [2, 1.5], [3, 0.5], [4, 0]]))
    expect(formatPartialScoring(multi(4), 3)).toBe(
      'bez chyby 3 b. · 1 chyba 2 b. · 2 chyby 1,5 b. · 3 chyby 0,5 b. · 4 a víc chyb 0 b.',
    )
  })

  it('handles 1 point over 2 parts', () => {
    expect(partialScoring(trueFalse(2), 1)).toEqual(steps([[0, 1], [1, 0.5], [2, 0]]))
  })

  it('stops at the first zero: 2 points over 5 parts', () => {
    expect(partialScoring(trueFalse(5), 2)).toEqual(steps([[0, 2], [1, 1.5], [2, 1], [3, 0.5], [4, 0]]))
  })

  it('uses the genitive plural from five errors on: 10 parts, 10 points', () => {
    const line = formatPartialScoring(trueFalse(10), 10)
    expect(line).toContain('5 chyb 5 b.')
    expect(line).toContain('9 chyb 1 b.')
    expect(line?.endsWith('10 a víc chyb 0 b.')).toBe(true)
  })

  it('keeps half-point totals and rounds the rest down to halves', () => {
    expect(partialScoring(trueFalse(3), 2.5)).toEqual(steps([[0, 2.5], [1, 1.5], [2, 0.5], [3, 0]]))
  })

  it('counts blank table cells, not filled ones', () => {
    const table = makeQuestion({
      type: 'table_fill',
      payload: { prompt: 'Doplň.', headers: ['a', 'b'], rows: [['x', null], [null, null]], answers: ['1', '2', '3'] },
    })
    expect(partialScoring(table, 3)).toEqual(steps([[0, 3], [1, 2], [2, 1], [3, 0]]))
  })

  it('gives no line for 0 points, a single part or a type scored as a whole', () => {
    expect(partialScoring(multi(4), 0)).toBeNull()
    expect(partialScoring(multi(1), 2)).toBeNull()
    const single = makeQuestion({
      type: 'single_choice',
      payload: { prompt: 'Vyber.', options: ['a', 'b'], correctIndex: 0 },
    })
    expect(partialScoring(single, 3)).toBeNull()
    expect(formatPartialScoring(single, 3)).toBeNull()
  })
})
