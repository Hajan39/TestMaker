import type { ReactNode } from 'react'

/**
 * Obal obsahu stránek mimo knihovnu: rolování, odsazení a rozumná maximální šířka.
 * `ThreePane` si rolování řídí samo ve svých sloupcích — tahle komponenta je jediná
 * cesta pro všechno ostatní, aby nevznikly dvě různá řešení téhož.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
    </div>
  )
}
