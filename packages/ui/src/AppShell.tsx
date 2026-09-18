import type { ReactNode } from 'react'
import { cn } from './cn'
import { Mark } from './Mark'
import { ThemeToggle } from './ThemeToggle'

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
  status,
  children,
}: {
  nav: NavItem[]
  activeHref: string
  renderLink: (item: NavItem, active: boolean) => ReactNode
  /**
   * Tichý ukazatel vpravo v liště, vedle přepínače motivu — třeba to, že se
   * někde na pozadí generují otázky. Vykresluje ho aplikace, balíček o jeho
   * obsahu nic neví.
   */
  status?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="surface-chrome flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-surface-muted px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-bold tracking-tight text-fg">
          <Mark />
          TestMaker
        </span>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
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
        <div className="ml-auto flex items-center gap-2">
          {status}
          <ThemeToggle />
        </div>
      </header>
      <main className="surface-content min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
    </div>
  )
}
