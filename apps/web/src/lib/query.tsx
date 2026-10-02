'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * TanStack Query for everything the browser reads from the API: caching,
 * polling (`refetchInterval`), retries and shared state between components
 * (the toolbar indicator and the generation overview read the same query).
 * Saving goes through `useMutation`; pages rendered on the server still take
 * their data from the server and `router.refresh()`.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  // One client per browser tab — created in state, so a re-render keeps it.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // An overview that was just fetched need not be fetched again on
            // every mount; polling and invalidation keep it fresh.
            staleTime: 2_000,
            retry: 1,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
