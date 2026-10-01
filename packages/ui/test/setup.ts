import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Every test starts with an empty DOM.
afterEach(() => cleanup())

/**
 * jsdom lacks `matchMedia`, used by the layout and the theme toggle.
 * We add the smallest stand-in: nothing ever matches (i.e. a wide window,
 * light theme) and listeners can be added and removed.
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
