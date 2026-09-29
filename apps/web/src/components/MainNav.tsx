'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AppShell, type NavItem } from '@testmaker/ui'
import { GenerationStatus } from '@/components/GenerationStatus'
import { SkolaPrepinac } from '@/components/SkolaPrepinac'
import { UserMenu } from '@/components/UserMenu'
import { roleJeAdministrator, roleMuzeSpravovat, type Role } from '@/lib/role'

// Import materiálů a přehled generování zůstávají jako stránky (odkazy z
// úvodu, ukazatel v liště), ale v liště samotné už nejsou — obojí je jen
// vstup do práce, kterou učitelka dělá výjimečně, ne místo, kam se vrací.
const NAV: NavItem[] = [
  { href: '/', label: 'Třídy' },
  { href: '/tests', label: 'Testy' },
  { href: '/hlavolamy', label: 'Hlavolamy' },
  { href: '/templates', label: 'Šablony' },
]

/** Položky jen pro správce — účty, události a zálohy školy. */
const NAV_SPRAVCE: NavItem[] = [{ href: '/sprava', label: 'Správa' }]

/**
 * Určí href položky navigace, pod kterou patří daná cesta. Kořenová cesta „/“
 * musí být přesná shoda, jinak by Třídy svítily na každé stránce. Ostatní
 * položky pokrývají i své podtrasy (např. /tests/new i /tests/<id> patří pod Testy).
 */
function findActiveHref(pathname: string, nav: NavItem[]): string {
  const match = nav.find((item) => {
    if (item.href === '/') return pathname === '/'
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  })
  if (match) return match.href
  // Stránka třídy (/tridy/...) i detail tématu (/topics/...) patří pod Třídy.
  if (pathname.startsWith('/tridy') || pathname.startsWith('/topics')) return '/'
  return pathname
}

/** Kdo je přihlášený, jak ho ukazuje lišta. */
export interface UcetVListe {
  jmeno: string
  email: string
  role: Role
  /** Škola, ve které se právě pracuje. */
  skola: { id: string; name: string }
  domovskaSkolaId: string
  /** Všechny školy — jen u administrátora, jinak prázdné. */
  skoly: { id: string; name: string }[]
}

/** Klientská skořápka aplikace: určí aktivní položku navigace podle aktuální cesty. */
export function MainNav({
  children,
  ucet,
}: {
  children: React.ReactNode
  /** Bez přihlašování (lokální běh) se jméno v liště neukazuje. */
  ucet: UcetVListe | null
}) {
  const pathname = usePathname()
  const nav = ucet && roleMuzeSpravovat(ucet.role) ? [...NAV, ...NAV_SPRAVCE] : NAV
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
          {ucet && roleJeAdministrator(ucet.role) ? (
            <SkolaPrepinac skola={ucet.skola} domovskaSkolaId={ucet.domovskaSkolaId} skoly={ucet.skoly} />
          ) : null}
          {ucet ? <UserMenu jmeno={ucet.jmeno} email={ucet.email} role={ucet.role} /> : null}
        </>
      }
      renderLink={(item, active) => (
        // Třídy v liště vedou vždy na přehled dlaždic (`?vse=1`), i když je
        // zapamatovaná třída — jinak by se z lišty nedalo dostat zpátky na
        // výběr a jediná cesta ven byla odkaz „Všechny třídy“ na téže stránce.
        <Link
          href={item.href === '/' ? '/?vse=1' : item.href}
          aria-current={active ? 'page' : undefined}
        >
          {item.label}
        </Link>
      )}
    >
      {children}
    </AppShell>
  )
}
