'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AppShell, type NavItem } from '@testmaker/ui'

const NAV: NavItem[] = [
  { href: '/', label: 'Knihovna' },
  { href: '/import', label: 'Import materiálů' },
  { href: '/review', label: 'Kontrola' },
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

/**
 * Kolik konceptů čeká na kontrolu. Číslo se zjišťuje nejlevnějším možným
 * dotazem — jedna stránka o jediné otázce, ze které se čte jen `total`.
 * Obnovuje se při každém přechodu mezi stránkami: po generování i po
 * odbavení fronty tak sedí, aniž by se cokoli dotazovalo v kole.
 */
function usePendingCount(pathname: string): number | null {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let platne = true
    fetch('/api/questions?status=draft&limit=1')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { total?: number } | null) => {
        if (platne && typeof data?.total === 'number') setCount(data.total)
      })
      .catch(() => {
        // Číslo u položky navigace je jen doplněk; když se nenačte, nic se neděje.
      })
    return () => {
      platne = false
    }
  }, [pathname])

  return count
}

/** Klientská skořápka aplikace: určí aktivní položku navigace podle aktuální cesty. */
export function MainNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const activeHref = findActiveHref(pathname)
  const pending = usePendingCount(pathname)

  return (
    <AppShell
      nav={NAV}
      activeHref={activeHref}
      renderLink={(item, active) => (
        <Link href={item.href} aria-current={active ? 'page' : undefined}>
          {item.label}
          {item.href === '/review' && pending ? (
            <span className="ui-numeric ml-1.5 rounded-full bg-draft-bg px-1.5 py-0.5 text-xs text-draft-fg">
              {pending}
            </span>
          ) : null}
        </Link>
      )}
    >
      {children}
    </AppShell>
  )
}
