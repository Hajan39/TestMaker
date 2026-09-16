import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Delayed, LoadingCard, LoadingHeading, LoadingTiles } from '../src/Loading'

/**
 * Kostry obsahu. V prohlížeči se `loading.tsx` nedá spolehlivě vyvolat
 * (zdržená síť jen odloží přechod), proto se jejich chování hlídá tady.
 */
describe('kostry obsahu', () => {
  it('oznámí čekání odečítači obrazovky, ale kostra sama je jen obrázek', () => {
    render(
      <Delayed label="Načítám téma…">
        <LoadingCard />
      </Delayed>,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Načítám téma…')
    // Zpoždění drží třída; bez ní by kostra u rychlé odpovědi zablikala.
    expect(status).toHaveClass('ui-delayed')
  })

  it('kostra má tolik dílků, kolik se jí zadá', () => {
    const { container } = render(<LoadingTiles count={4} />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(4)
  })

  it('kostra nadpisu umí i řádek s počty', () => {
    const { container } = render(<LoadingHeading stats />)
    const withStats = container.querySelectorAll('[data-slot="skeleton"]').length

    const { container: plain } = render(<LoadingHeading />)
    expect(withStats).toBeGreaterThan(plain.querySelectorAll('[data-slot="skeleton"]').length)
  })

  it('kostra nenese žádný text, který by čtečka přečetla dvakrát', () => {
    const { container } = render(<LoadingCard lines={3} />)
    expect(container.textContent).toBe('')
  })
})
