'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AppShell, type NavItem } from '@testmaker/ui'
import { GenerationStatus } from '@/components/GenerationStatus'
import { UserMenu } from '@/components/UserMenu'
import type { Role } from '@/lib/role'

const NAV: NavItem[] = [
  { href: '/', label: 'Knihovna' },
  { href: '/import', label: 'Import materiálů' },
  // Přehled generování musí jít otevřít i ve chvíli, kdy nic neběží — ukazatel
  // v liště sám o sobě k nedokončeným tématům druhý den nedovede.
  { href: '/generovani', label: 'Generování' },
  { href: '/questions', label: 'Banka otázek' },
  { href: '/tests', label: 'Testy' },
  { href: '/hlavolamy', label: 'Hlavolamy' },
  { href: '/templates', label: 'Šablony' },
]

/** Položky jen pro správce — účty, události a zálohy školy. */
const NAV_SPRAVCE: NavItem[] = [{ href: '/sprava', label: 'Správa' }]

/**
 * Určí href položky navigace, pod kterou patří daná cesta. Kořenová cesta „/“
 * musí být přesná shoda, jinak by Knihovna svítila na každé stránce. Ostatní
 * položky pokrývají i své podtrasy (např. /tests/new i /tests/<id> patří pod Testy).
 */
function findActiveHref(pathname: string, nav: NavItem[]): string {
  const match = nav.find((item) => {
    if (item.href === '/') return pathname === '/'
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  })
  if (match) return match.href
  // Detail tématu (/topics/...) patří pod Knihovnu.
  if (pathname.startsWith('/topics')) return '/'
  return pathname
}

/** Klientská skořápka aplikace: určí aktivní položku navigace podle aktuální cesty. */
export function MainNav({
  children,
  ucet,
}: {
  children: React.ReactNode
  /** Bez přihlašování (lokální běh) se jméno v liště neukazuje. */
  ucet: { jmeno: string; email: string; role: Role } | null
}) {
  const pathname = usePathname()
  // Náhled nemá co importovat ani generovat — položky, které vedou jedině
  // k zápisu, se mu vůbec nenabízejí.
  const zaklad =
    ucet?.role === 'nahled'
      ? NAV.filter((item) => item.href !== '/import' && item.href !== '/generovani')
      : NAV
  const nav = ucet?.role === 'spravce' ? [...zaklad, ...NAV_SPRAVCE] : zaklad
  const activeHref = findActiveHref(pathname, nav)

  return (
    <AppShell
      nav={nav}
      activeHref={activeHref}
      // Generování běží na pozadí i po odchodu ze stránky tématu; tohle je
      // jediné místo, kde je vidět odkudkoli.
      status={
        <>
          <GenerationStatus pathname={pathname} />
          {ucet ? <UserMenu jmeno={ucet.jmeno} email={ucet.email} role={ucet.role} /> : null}
        </>
      }
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
