import type { ReactNode } from 'react'
import { cn } from './cn'
import { Mark } from './Mark'

export interface NavItem {
  href: string
  label: string
}

/**
 * Jediná skořápka aplikace: lišta se značkou a přepínačem oblastí, pod ní
 * pracovní plocha. Odkazy vykresluje volající, aby balíček nezávisel na routeru.
 */
export function AppShell({
  nav,
  activeHref,
  renderLink,
  children,
}: {
  nav: NavItem[]
  activeHref: string
  renderLink: (item: NavItem, active: boolean) => ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="surface-chrome flex shrink-0 items-center gap-6 border-b border-line bg-surface-muted px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-bold tracking-tight text-fg">
          <Mark />
          TestMaker
        </span>
        <nav className="flex items-center gap-1 text-sm">
          {nav.map((item) => {
            const active = item.href === activeHref
            return (
              <span
                key={item.href}
                className={cn(
                  'rounded-[var(--radius-inner)] px-2.5 py-1',
                  active ? 'bg-brand-bg font-semibold text-brand' : 'text-fg-muted hover:text-fg',
                )}
              >
                {renderLink(item, active)}
              </span>
            )
          })}
        </nav>
      </header>
      <main className="surface-content min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
