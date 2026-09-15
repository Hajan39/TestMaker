import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatRow } from '../src'

describe('StatRow', () => {
  it('vypíše hodnotu i popisek', () => {
    render(<StatRow items={[{ value: 3, label: 'materiály' }, { value: 18, label: 'otázek' }]} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('materiály')).toBeInTheDocument()
  })

  it('čísla jsou tabulková, aby neposkakovala', () => {
    render(<StatRow items={[{ value: 120, label: 'otázek' }]} />)
    expect(screen.getByText('120')).toHaveClass('ui-numeric')
  })

  it('zvýrazní počet čekajících konceptů', () => {
    render(<StatRow items={[{ value: 6, label: 'ke schválení', tone: 'draft' }]} />)
    expect(screen.getByText('6')).toHaveClass('text-draft-fg')
  })
})
