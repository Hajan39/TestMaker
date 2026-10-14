import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeleteButton } from '../src'

describe('DeleteButton', () => {
  it('stays quiet on a neutral background and turns red on hover', () => {
    render(<DeleteButton label="Smazat téma" title="Smazat?" onConfirm={() => {}} />)
    expect(screen.getByRole('button', { name: 'Smazat téma' })).toHaveClass('text-fg-muted', 'hover:text-danger')
  })

  it('does not force the text colour on the destructive variant — otherwise red on red', () => {
    render(
      <DeleteButton label="Smazat (3)" variant="destructive" title="Smazat?" onConfirm={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Smazat (3)' })).not.toHaveClass('text-danger')
  })
})
