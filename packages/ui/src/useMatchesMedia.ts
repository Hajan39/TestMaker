'use client'

import { useSyncExternalStore } from 'react'

/**
 * Sleduje šířku okna. Vrací `false` na serveru, kde se vykresluje široká podoba.
 *
 * Slouží k tomu, aby se rozvržení vykreslilo jen jednou. Obě podoby naráz —
 * jedna schovaná přes `hidden` — znamenají zdvojená `id`, popisky polí mířící
 * na neviditelnou kopii a zdvojené prvky ve všem, co stránku prochází.
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
