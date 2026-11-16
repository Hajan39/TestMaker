import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { DecimalInput } from '../src'

/** A field with its value in the parent's state, as in the app. */
function Field({ initial = 1, onValue }: { initial?: number; onValue?: (value: number) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <DecimalInput
      aria-label="Body"
      min={0}
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onValue?.(next)
      }}
    />
  )
}

const field = () => screen.getByLabelText('Body') as HTMLInputElement
const type = (text: string) => fireEvent.change(field(), { target: { value: text } })

describe('DecimalInput', () => {
  it('shows the number with a decimal comma and offers a numeric keyboard', () => {
    render(<Field initial={1.5} />)
    expect(field().value).toBe('1,5')
    expect(field().inputMode).toBe('decimal')
  })

  it('a decimal comma and a dot mean the same', () => {
    const values: number[] = []
    render(<Field onValue={(value) => values.push(value)} />)
    type('1,5')
    type('2.5')
    expect(values).toEqual([1.5, 2.5])
  })

  it('a just-typed comma stays in the field', () => {
    render(<Field initial={1} />)
    type('1,')
    expect(field().value).toBe('1,')
  })

  it('something that is not a number is marked and changes nothing', () => {
    const values: number[] = []
    render(<Field onValue={(value) => values.push(value)} />)
    type('abc')
    expect(values).toEqual([])
    expect(field().getAttribute('aria-invalid')).toBe('true')
    // Leaving the field shows the value that counts again.
    fireEvent.blur(field())
    expect(field().value).toBe('1')
  })

  it('keeps the value within the limits', () => {
    const values: number[] = []
    render(<Field onValue={(value) => values.push(value)} />)
    type('-3')
    expect(values).toEqual([0])
  })
})
