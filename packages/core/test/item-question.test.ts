import { describe, expect, it } from 'vitest'
import { itemQuestion } from '../src/schema/test'

const fill = {
  type: 'fill_blank',
  payload: { prompt: 'Doplň.', text: 'A ___ B', blanks: ['x'], wordBank: ['x', 'y'] },
}

describe('question as the test prints it', () => {
  it('a hidden word bank is left out, the bank question keeps it', () => {
    expect(itemQuestion(fill, { wordBankHidden: true }).payload.wordBank).toEqual([])
    expect(fill.payload.wordBank).toEqual(['x', 'y'])
  })

  it('without the setting nothing changes', () => {
    expect(itemQuestion(fill, {})).toBe(fill)
    const open = { type: 'open', payload: { prompt: 'Popiš.' } }
    expect(itemQuestion(open, { wordBankHidden: true })).toBe(open)
  })
})
