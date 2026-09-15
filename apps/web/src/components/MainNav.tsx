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

/** Klientská skořápka aplikace: určí aktivní položku navigace podle aktuální cesty. */
export function MainNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // Detail tématu (/topics/...) patří pod Knihovnu.
  const activeHref = pathname.startsWith('/topics') ? '/' : pathname

  return (
    <AppShell
      nav={NAV}
      activeHref={activeHref}
      renderLink={(item) => <Link href={item.href}>{item.label}</Link>}
    >
      {children}
    </AppShell>
  )
}
