'use client'

import { useState } from 'react'
import { TAB_PARAM, tabFrom } from '@/lib/tabs'

/**
 * Open tab kept in `?karta=`. The page reads the parameter on the server and
 * passes it in, so the right tab renders straight away; switching only
 * replaces the URL (no new history entry, no reload) — the Back button still
 * leaves the page instead of walking through tabs.
 */
export function useUrlTab<T extends string>(tabs: readonly T[], initial: T): [T, (value: string) => void] {
  const [tab, setTab] = useState<T>(initial)
  const change = (value: string) => {
    const next = tabFrom(tabs, value)
    setTab(next)
    const url = new URL(window.location.href)
    if (next === tabs[0]) url.searchParams.delete(TAB_PARAM)
    else url.searchParams.set(TAB_PARAM, next)
    window.history.replaceState(window.history.state, '', url)
  }
  return [tab, change]
}
