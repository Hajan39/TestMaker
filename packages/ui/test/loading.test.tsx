import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Delayed, LoadingCard, LoadingHeading, LoadingTiles } from '../src/Loading'

/**
 * Content skeletons. `loading.tsx` cannot be triggered reliably in the
 * browser (a slowed network only delays the transition), so their behaviour
 * is checked here.
 */
describe('content skeletons', () => {
  it('announces waiting to screen readers, while the skeleton itself is just a picture', () => {
    render(
      <Delayed label="Načítám téma…">
        <LoadingCard />
      </Delayed>,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Načítám téma…')
    // The class holds the delay; without it the skeleton would flash on a fast response.
    expect(status).toHaveClass('ui-delayed')
  })

  it('the skeleton has as many pieces as requested', () => {
    const { container } = render(<LoadingTiles count={4} />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(4)
  })

  it('the heading skeleton can include the stats row', () => {
    const { container } = render(<LoadingHeading stats />)
    const withStats = container.querySelectorAll('[data-slot="skeleton"]').length

    const { container: plain } = render(<LoadingHeading />)
    expect(withStats).toBeGreaterThan(plain.querySelectorAll('[data-slot="skeleton"]').length)
  })

  it('the skeleton carries no text a screen reader would read twice', () => {
    const { container } = render(<LoadingCard lines={3} />)
    expect(container.textContent).toBe('')
  })
})
