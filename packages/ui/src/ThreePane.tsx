import type { ReactNode } from 'react'

/**
 * Tři sloupce podle specifikace. Pod 1280 px odpadá druhý sloupec,
 * pod 1024 px oba — obsah pak zabírá celou šířku.
 */
export function ThreePane({
  first,
  second,
  children,
}: {
  first: ReactNode
  second: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0">
      <aside className="surface-chrome hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-surface-muted p-3 lg:block">
        {first}
      </aside>
      <aside className="surface-chrome hidden w-70 shrink-0 overflow-y-auto border-r border-line p-3 xl:block">
        {second}
      </aside>
      <section className="surface-content min-w-0 flex-1 overflow-y-auto p-5">{children}</section>
    </div>
  )
}
