'use client'

import { useSyncExternalStore } from 'react'

/**
 * Tracks the window width. Returns `false` on the server, where the wide
 * layout renders.
 *
 * It lets the layout render only once. Both layouts at once — one hidden via
 * `hidden` — mean duplicated `id`s, field labels pointing at an invisible copy
 * and duplicated elements for everything that walks the page.
 */
export function useMatchesMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
