'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AppShell, type NavItem } from '@testmaker/ui'

const NAV: NavItem[] = [
  { href: '/', label: 'Knihovna' },
  { href: '/import', label: 'Import materiálů' },
  { href: '/questions', label: 'Banka otázek' },
  { href: '/tests', label: 'Testy' },
  { href: '/templates', label: 'Šablony' },
]

/**
 * Určí href položky navigace, pod kterou patří daná cesta. Kořenová cesta „/“
 * musí být přesná shoda, jinak by Knihovna svítila na každé stránce. Ostatní
 * položky pokrývají i své podtrasy (např. /tests/new i /tests/<id> patří pod Testy).
 */
function findActiveHref(pathname: string): string {
  const match = NAV.find((item) => {
    if (item.href === '/') return pathname === '/'
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  })
  if (match) return match.href
  // Detail tématu (/topics/...) patří pod Knihovnu.
  if (pathname.startsWith('/topics')) return '/'
  return pathname
}

/** Klientská skořápka aplikace: určí aktivní položku navigace podle aktuální cesty. */
export function MainNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const activeHref = findActiveHref(pathname)

  return (
    <AppShell
      nav={NAV}
      activeHref={activeHref}
      renderLink={(item, active) => (
        <Link href={item.href} aria-current={active ? 'page' : undefined}>
          {item.label}
        </Link>
      )}
    >
      {children}
    </AppShell>
  )
}
