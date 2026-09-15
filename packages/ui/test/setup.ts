import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Každý test začíná s prázdným DOM.
afterEach(() => cleanup())

/**
 * jsdom neumí `matchMedia`, kterou používá rozvržení i přepínač motivu.
 * Doplňujeme nejmenší náhradu: nikdy nic neodpovídá (tedy široké okno,
 * světlý motiv) a posluchače lze přidat i odebrat.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}
