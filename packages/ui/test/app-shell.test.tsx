import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../src'

const nav = [
  { href: '/', label: 'Knihovna' },
  { href: '/tests', label: 'Testy' },
  { href: '/templates', label: 'Šablony' },
]

describe('AppShell', () => {
  it('renders the logo, navigation and content', () => {
    render(
      <AppShell
        nav={nav}
        activeHref="/"
        renderLink={(item, active) => (
          <a href={item.href} aria-current={active ? 'page' : undefined}>
            {item.label}
          </a>
        )}
      >
        <p>Obsah</p>
      </AppShell>,
    )
    expect(screen.getByText('TestMaker')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Testy' })).toBeInTheDocument()
    expect(screen.getByText('Obsah')).toBeInTheDocument()
  })

  it('marks the active item for screen readers', () => {
    render(
      <AppShell
        nav={nav}
        activeHref="/tests"
        renderLink={(item, active) => (
          <a href={item.href} aria-current={active ? 'page' : undefined}>
            {item.label}
          </a>
        )}
      >
        <p>Obsah</p>
      </AppShell>,
    )
    expect(screen.getByRole('link', { name: 'Testy' })).toHaveAttribute('aria-current', 'page')
  })

  it('the bar has the sharper emphasis, the workspace the milder one', () => {
    const { container } = render(
      <AppShell
        nav={nav}
        activeHref="/"
        renderLink={(item, active) => (
          <a href={item.href} aria-current={active ? 'page' : undefined}>
            {item.label}
          </a>
        )}
      >
        <p>Obsah</p>
      </AppShell>,
    )
    expect(container.querySelector('header')).toHaveClass('surface-chrome')
    expect(container.querySelector('main')).toHaveClass('surface-content')
  })
})
