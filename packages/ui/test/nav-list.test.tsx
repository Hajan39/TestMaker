import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NavList } from '../src'

const items = [
  { id: 't1', label: 'Dýchací soustava', count: 18 },
  { id: 't2', label: 'Trávicí soustava', count: 12, flag: true },
  { id: 't3', label: 'Oběhová soustava', count: 0 },
]

describe('NavList', () => {
  it('vypíše položky s počty', () => {
    render(<NavList items={items} activeId="t1" renderItem={(i) => <a href="#">{i.label}</a>} />)
    expect(screen.getByText('Dýchací soustava')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })

  it('označí aktivní položku', () => {
    render(<NavList items={items} activeId="t2" renderItem={(i) => <a href="#">{i.label}</a>} />)
    const active = screen.getByText('Trávicí soustava').closest('[aria-current]')
    expect(active).toHaveAttribute('aria-current', 'true')
  })

  it('u položky s příznakem ukáže, že čeká kontrola', () => {
    render(<NavList items={items} activeId="t1" renderItem={(i) => <a href="#">{i.label}</a>} />)
    expect(screen.getByLabelText('Čekají nezkontrolované koncepty')).toBeInTheDocument()
  })
})
