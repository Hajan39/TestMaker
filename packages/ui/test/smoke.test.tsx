import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cn } from '../src/cn'

describe('testovací zázemí', () => {
  it('vykreslí komponentu do jsdom', () => {
    render(<p className={cn('a', 'b')}>Ahoj</p>)
    expect(screen.getByText('Ahoj')).toBeInTheDocument()
  })
})
