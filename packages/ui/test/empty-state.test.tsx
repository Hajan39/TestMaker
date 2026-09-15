import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '../src'

describe('EmptyState', () => {
  it('ukáže nadpis, nápovědu i akci', () => {
    render(<EmptyState title="Žádné otázky" hint="Vygeneruj je z materiálů." action={<button>Generovat</button>} />)
    expect(screen.getByText('Žádné otázky')).toBeInTheDocument()
    expect(screen.getByText('Vygeneruj je z materiálů.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generovat' })).toBeInTheDocument()
  })

  it('bez nápovědy a akce vykreslí jen nadpis', () => {
    render(<EmptyState title="Prázdno" />)
    expect(screen.getByText('Prázdno')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
