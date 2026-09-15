import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../src'

const nav = [
  { href: '/', label: 'Knihovna' },
  { href: '/tests', label: 'Testy' },
  { href: '/templates', label: 'Šablony' },
]

describe('AppShell', () => {
  it('vykreslí značku, navigaci a obsah', () => {
    render(
      <AppShell nav={nav} activeHref="/" renderLink={(item) => <a href={item.href}>{item.label}</a>}>
        <p>Obsah</p>
      </AppShell>,
    )
    expect(screen.getByText('TestMaker')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Testy' })).toBeInTheDocument()
    expect(screen.getByText('Obsah')).toBeInTheDocument()
  })

  it('označí aktivní položku pro čtečky obrazovky', () => {
    render(
      <AppShell nav={nav} activeHref="/tests" renderLink={(item) => <a href={item.href}>{item.label}</a>}>
        <p>Obsah</p>
      </AppShell>,
    )
    const active = screen.getByRole('link', { name: 'Testy' }).closest('[aria-current]')
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('lišta nese ostřejší důraz, plocha mírnější', () => {
    const { container } = render(
      <AppShell nav={nav} activeHref="/" renderLink={(item) => <a href={item.href}>{item.label}</a>}>
        <p>Obsah</p>
      </AppShell>,
    )
    expect(container.querySelector('header')).toHaveClass('surface-chrome')
    expect(container.querySelector('main')).toHaveClass('surface-content')
  })
})
