import type { ReactNode } from 'react'
import { t } from '@testmaker/core/i18n'
import { cn } from './cn'
import { Mark } from './Mark'
import { ThemeToggle } from './ThemeToggle'

export interface NavItem {
  href: string
  label: string
}

/**
 * The app's single shell: a bar with the logo and the area switcher, the
 * workspace below. The caller renders the links so the package does not depend
 * on a router.
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
   * A quiet indicator on the right of the bar, next to the theme toggle — e.g.
   * that questions are being generated in the background. The app renders it;
   * the package knows nothing about its content.
   */
  status?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="relative flex h-dvh flex-col bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--radius-inner)] focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand focus:ring-2 focus:ring-ring"
      >
        {t('ui:appShell.skipToContent')}
      </a>
      <header className="surface-chrome flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-surface-muted px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-bold tracking-tight text-fg">
          <Mark />
          TestMaker
        </span>
        {/* On a phone the nav takes its own scrolling second row, so the logo
            and the toggle/user stay together on the first one. */}
        <nav className="order-last flex w-full flex-nowrap items-center gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto sm:flex-wrap">
          {nav.map((item) => {
            const active = item.href === activeHref
            return (
              // The padding sits on the link, so the whole pill is clickable.
              <span
                key={item.href}
                className={cn(
                  'flex shrink-0 whitespace-nowrap rounded-[var(--radius-inner)] [&>a]:rounded-[var(--radius-inner)] [&>a]:px-2.5 [&>a]:py-1.5',
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
      <main id="main" tabIndex={-1} className="surface-content outline-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
    </div>
  )
}
