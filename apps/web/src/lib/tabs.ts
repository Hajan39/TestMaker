/** Query parameter that remembers the open tab, so a reload returns to it (`useUrlTab`). */
export const TAB_PARAM = 'karta'

/** The tab from the URL if it is one of `tabs`, otherwise the first one. */
export function tabFrom<T extends string>(tabs: readonly T[], value: string | null | undefined): T {
  return tabs.includes(value as T) ? (value as T) : tabs[0]!
}

/** Tabs of the management page, in order; the first one is the default. */
export const MANAGEMENT_TABS = ['ucty', 'udalosti', 'provoz', 'ai-kvalita'] as const
export type ManagementTab = (typeof MANAGEMENT_TABS)[number]
