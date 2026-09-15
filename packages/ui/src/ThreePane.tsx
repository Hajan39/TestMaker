'use client'

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

/** Sleduje šířku okna. Vrací `false` na serveru, kde se vykresluje široká podoba. */
function useMatchesMedia(query: string): boolean {
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

/**
 * Tři sloupce podle specifikace. Pod 1280 px odpadá druhý sloupec,
 * pod 1024 px zůstává jeden sloupec a mezi sloupci se přepíná záložkami.
 *
 * Obsah se vykresluje jen jednou. Dřívější podoba měla obě varianty v stránce
 * současně a jednu skrývala, čímž vznikala zdvojená `id` a popisky polí mířily
 * na neviditelnou kopii.
 */
export function ThreePane({
  first,
  second,
  firstLabel = 'Předměty a ročníky',
  secondLabel = 'Témata ročníku',
  contentLabel = 'Obsah tématu',
  children,
}: {
  first: ReactNode
  second: ReactNode
  firstLabel?: string
  secondLabel?: string
  contentLabel?: string
  children: ReactNode
}) {
  const narrow = useMatchesMedia('(max-width: 1023.98px)')

  if (narrow) {
    return (
      <div className="surface-chrome h-full min-h-0">
        <Tabs defaultValue="content" className="flex h-full min-h-0 flex-col gap-0">
          <TabsList className="shrink-0">
            <TabsTrigger value="first">{firstLabel}</TabsTrigger>
            <TabsTrigger value="second">{secondLabel}</TabsTrigger>
            <TabsTrigger value="content">{contentLabel}</TabsTrigger>
          </TabsList>
          <TabsContent value="first" className="min-h-0 flex-1 overflow-y-auto bg-surface-muted p-3">
            {first}
          </TabsContent>
          <TabsContent value="second" className="min-h-0 flex-1 overflow-y-auto p-3">
            {second}
          </TabsContent>
          <TabsContent value="content" className="surface-content min-h-0 flex-1 overflow-y-auto p-5">
            {children}
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="surface-chrome w-60 shrink-0 overflow-y-auto border-r border-line bg-surface-muted p-3">
        {first}
      </aside>
      <aside className="surface-chrome hidden w-70 shrink-0 overflow-y-auto border-r border-line p-3 xl:block">
        {second}
      </aside>
      <section className="surface-content min-w-0 flex-1 overflow-y-auto p-5">{children}</section>
    </div>
  )
}
