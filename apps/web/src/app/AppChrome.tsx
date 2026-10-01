'use client'

import { usePathname } from 'next/navigation'
import { MainNav, type NavAccount } from '@/components/MainNav'
import { PermissionsProvider } from '@/components/Permissions'
import { roleCanManage } from '@/lib/role'

/**
 * Pages for signed-out users (route group `(auth)`). We draw no app
 * navigation around them: someone not signed in cannot click anywhere anyway.
 *
 * The decision is by path, not by route group: a group layout is always
 * *inside* the root one, so it cannot remove the root navigation by itself.
 * The alternative — moving all other routes into an `(app)` group with its
 * own layout — would mean moving files that are being worked on elsewhere.
 */
const NO_NAVIGATION = ['/login', '/zmena-hesla']

export function AppChrome({
  children,
  account,
}: {
  children: React.ReactNode
  /** The signed-in person; `null` without sign-in (local run). */
  account: NavAccount | null
}) {
  const pathname = usePathname()
  // Without sign-in (local run) work happens as a manager, i.e. with full rights.
  const canEdit = account === null || account.role !== 'nahled'
  const canManage = account === null || roleCanManage(account.role)
  // The bar has no business on the login page or during a forced password change.
  if (NO_NAVIGATION.includes(pathname)) return <>{children}</>
  return (
    <PermissionsProvider canEdit={canEdit} canManage={canManage}>
      <MainNav account={account}>{children}</MainNav>
    </PermissionsProvider>
  )
}
