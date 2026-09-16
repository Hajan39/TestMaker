import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeleteButton } from '../src'

describe('DeleteButton', () => {
  it('na neutrálním podkladu má červený nápis', () => {
    render(<DeleteButton label="Smazat téma" title="Smazat?" onConfirm={() => {}} />)
    expect(screen.getByRole('button', { name: 'Smazat téma' })).toHaveClass('text-danger')
  })

  it('u destruktivní varianty nevnucuje barvu textu — jinak je červená na červené', () => {
    render(
      <DeleteButton label="Smazat (3)" variant="destructive" title="Smazat?" onConfirm={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Smazat (3)' })).not.toHaveClass('text-danger')
  })
})
