import { describe, expect, it } from 'vitest'
import { splitList, tidyPayload } from '../src/schema/tidy'

describe('splitList', () => {
  it('a semicolon separates items', () => {
    expect(splitList('první; druhá ;třetí')).toEqual(['první', 'druhá', 'třetí'])
  })

  it('without a semicolon a comma separates too', () => {
    expect(splitList('první, druhá,třetí')).toEqual(['první', 'druhá', 'třetí'])
  })

  it('a decimal comma stays inside the number', () => {
    expect(splitList('3,5, 4,25')).toEqual(['3,5', '4,25'])
  })

  it('with a semicolon, commas belong to the items', () => {
    expect(splitList('Praha, Brno; Ostrava')).toEqual(['Praha, Brno', 'Ostrava'])
  })

  it('pasted lines separate', () => {
    expect(splitList('první\ndruhá, s čárkou')).toEqual(['první', 'druhá, s čárkou'])
  })

  it('empty items are dropped, unless kept on purpose', () => {
    expect(splitList('a;; b;')).toEqual(['a', 'b'])
    expect(splitList('a;; b', true)).toEqual(['a', '', 'b'])
  })
})

describe('tidyPayload', () => {
  it('trims texts', () => {
    expect(tidyPayload('short_answer', { prompt: '  Kolik?  ', answer: ' pět ', acceptedAnswers: [' 5 '] })).toEqual({
      prompt: 'Kolik?',
      answer: 'pět',
      acceptedAnswers: ['5'],
    })
  })

  it('an empty option left after „Přidat možnost“ is dropped and the correct one follows', () => {
    expect(
      tidyPayload('single_choice', { prompt: 'Vyber.', options: ['a', ' ', 'b', 'c'], correctIndex: 2 }),
    ).toEqual({ prompt: 'Vyber.', options: ['a', 'b', 'c'], correctIndex: 1 })
    expect(
      tidyPayload('multi_choice', { prompt: 'Vyber.', options: ['', 'a', 'b', '', 'c'], correctIndices: [1, 4] }),
    ).toEqual({ prompt: 'Vyber.', options: ['a', 'b', 'c'], correctIndices: [0, 2] })
  })

  it('an empty option marked as correct stays, so the error says what is wrong', () => {
    expect(tidyPayload('single_choice', { options: ['a', '', 'b'], correctIndex: 1 }).options).toEqual(['a', '', 'b'])
  })

  it('empty statements and ordering items are dropped', () => {
    expect(
      tidyPayload('true_false', { statements: [{ text: 'Ano.', isTrue: true }, { text: '  ', isTrue: true }] }),
    ).toEqual({ statements: [{ text: 'Ano.', isTrue: true }] })
    expect(tidyPayload('ordering', { items: ['a', '', 'b', 'c'] })).toEqual({ items: ['a', 'b', 'c'] })
  })

  it('empty matching rows are dropped and the pairs follow', () => {
    expect(
      tidyPayload('matching', {
        left: ['pes', '', 'kočka'],
        right: ['', 'štěká', 'mňouká'],
        pairs: [
          [0, 1],
          [2, 2],
        ],
      }),
    ).toEqual({
      left: ['pes', 'kočka'],
      right: ['štěká', 'mňouká'],
      pairs: [
        [0, 0],
        [1, 1],
      ],
    })
  })
})
