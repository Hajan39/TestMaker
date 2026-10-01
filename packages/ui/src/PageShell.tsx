import type { ReactNode } from 'react'

/**
 * Content wrapper for pages outside the library: scrolling, padding and a
 * sensible max width. `ThreePane` handles scrolling in its own columns — this
 * component is the only path for everything else, so there are not two
 * solutions to the same thing.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
    </div>
  )
}
