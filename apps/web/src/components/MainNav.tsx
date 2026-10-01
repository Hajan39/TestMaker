'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AppShell, type NavItem } from '@testmaker/ui'
import { GenerationStatus } from '@/components/GenerationStatus'
import { SchoolSwitcher } from '@/components/SchoolSwitcher'
import { UserMenu } from '@/components/UserMenu'
import { isAdministratorRole, roleCanManage, type Role } from '@/lib/role'
import { t } from '@testmaker/core/i18n'

// Material import and the generation overview remain pages (links from the
// home page, indicator in the bar) but are no longer in the bar itself — both
// are just entries into work the teacher does rarely, not a place to return to.
function navItems(): NavItem[] {
  return [
    { href: '/', label: t('auth:nav.classes') },
    { href: '/tests', label: t('auth:nav.tests') },
    { href: '/listy', label: t('auth:nav.worksheets') },
    { href: '/hlavolamy', label: t('auth:nav.puzzles') },
    { href: '/templates', label: t('auth:nav.templates') },
  ]
}

/** Items for managers only — the school's accounts, events and backups. */
function managerNavItems(): NavItem[] {
  return [{ href: '/sprava', label: t('auth:nav.management') }]
}

/**
 * Finds the href of the nav item a path belongs to. The root path "/" must
 * match exactly, otherwise Classes would light up on every page. Other items
 * also cover their subroutes (e.g. /tests/new and /tests/<id> belong to Tests).
 */
function findActiveHref(pathname: string, nav: NavItem[]): string {
  const match = nav.find((item) => {
    if (item.href === '/') return pathname === '/'
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  })
  if (match) return match.href
  // A class page (/tridy/...) and a topic detail (/topics/...) belong to Classes.
  if (pathname.startsWith('/tridy') || pathname.startsWith('/topics')) return '/'
  return pathname
}

/** Who is signed in, as the bar shows them. */
export interface NavAccount {
  name: string
  email: string
  role: Role
  /** The school currently being worked in. */
  school: { id: string; name: string }
  homeSchoolId: string
  /** Someone signing in only via Google has no password and cannot change it. */
  hasPassword: boolean
  /** All schools — only for an administrator, empty otherwise. */
  schools: { id: string; name: string }[]
}

/** Client app shell: picks the active nav item from the current path. */
export function MainNav({
  children,
  account,
}: {
  children: React.ReactNode
  /** Without sign-in (local run) no name is shown in the bar. */
  account: NavAccount | null
}) {
  const pathname = usePathname()
  const nav = account && roleCanManage(account.role) ? [...navItems(), ...managerNavItems()] : navItems()
  const activeHref = findActiveHref(pathname, nav)

  return (
    <AppShell
      nav={nav}
      activeHref={activeHref}
      // Generation runs in the background even after leaving the topic page;
      // this is the only place where it is visible from anywhere.
      status={
        <>
          <GenerationStatus pathname={pathname} />
          {account && isAdministratorRole(account.role) ? (
            <SchoolSwitcher school={account.school} homeSchoolId={account.homeSchoolId} schools={account.schools} />
          ) : null}
          {account ? <UserMenu name={account.name} email={account.email} role={account.role} hasPassword={account.hasPassword} /> : null}
        </>
      }
      renderLink={(item, active) => (
        // Classes in the bar always lead to the tile overview (`?vse=1`), even
        // with a remembered class — otherwise the bar could not get back to the
        // choice and the only way out would be the "All classes" link on that page.
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
