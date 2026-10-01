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
  it('lists items with counts', () => {
    render(<NavList items={items} activeId="t1" renderItem={renderRow} />)
    expect(screen.getByText('Dýchací soustava')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })

  it('marks the active item with aria-current="page" on the link', () => {
    render(<NavList items={items} activeId="t2" renderItem={renderRow} />)
    const active = screen.getByText('Trávicí soustava').closest('a')
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('shows that a flagged item awaits review', () => {
    render(<NavList items={items} activeId="t1" renderItem={renderRow} />)
    expect(screen.getByLabelText('Čekají nezkontrolované koncepty')).toBeInTheDocument()
  })

  it('the whole row is clickable, not just the item text', () => {
    render(<NavList items={items} activeId="t1" renderItem={renderRow} />)
    const link = screen.getByText('Trávicí soustava').closest('a')
    // The count and the unfinished-work dot must sit inside the same link as the text.
    expect(link).toContainElement(screen.getByText('12'))
    expect(link).toContainElement(screen.getByLabelText('Čekají nezkontrolované koncepty'))
  })
})
