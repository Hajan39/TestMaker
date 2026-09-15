import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { NavList, type NavListItem } from '../src'

const items: NavListItem[] = [
  { id: 't1', label: 'Dýchací soustava', count: 18 },
  { id: 't2', label: 'Trávicí soustava', count: 12, flag: true },
  { id: 't3', label: 'Oběhová soustava', count: 0 },
]

const renderRow = (item: NavListItem, content: ReactNode, active: boolean) => (
  <a href="#" aria-current={active ? 'page' : undefined}>
    {content}
  </a>
)

describe('NavList', () => {
  it('vypíše položky s počty', () => {
    render(<NavList items={items} activeId="t1" renderItem={renderRow} />)
    expect(screen.getByText('Dýchací soustava')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })

  it('označí aktivní položku atributem aria-current="page" na odkazu', () => {
    render(<NavList items={items} activeId="t2" renderItem={renderRow} />)
    const active = screen.getByText('Trávicí soustava').closest('a')
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('u položky s příznakem ukáže, že čeká kontrola', () => {
    render(<NavList items={items} activeId="t1" renderItem={renderRow} />)
    expect(screen.getByLabelText('Čekají nezkontrolované koncepty')).toBeInTheDocument()
  })

  it('klikatelný je celý řádek, ne jen text položky', () => {
    render(<NavList items={items} activeId="t1" renderItem={renderRow} />)
    const link = screen.getByText('Trávicí soustava').closest('a')
    // Počet i tečka u nedodělků musí ležet uvnitř téhož odkazu jako text.
    expect(link).toContainElement(screen.getByText('12'))
    expect(link).toContainElement(screen.getByLabelText('Čekají nezkontrolované koncepty'))
  })
})
