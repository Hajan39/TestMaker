'use client'

import { createContext, useContext } from 'react'

/**
 * May the signed-in person change content? The `nahled` role reads and prints
 * but changes nothing — and must learn that from the UI, not from a rejected
 * action. The gateway stops writing requests either way; this is the more
 * understandable half of that pair.
 */
const CanEditContext = createContext(true)
// Who may enter management (accounts, backups, deleting in the library) — only
// `spravce`. Same reason as `CanEditContext`: the button must disappear, not be
// offered and then silently fail at the gateway.
const CanManageContext = createContext(true)

export function PermissionsProvider({
  canEdit,
  canManage,
  children,
}: {
  canEdit: boolean
  canManage: boolean
  children: React.ReactNode
}) {
  return (
    <CanEditContext.Provider value={canEdit}>
      <CanManageContext.Provider value={canManage}>{children}</CanManageContext.Provider>
    </CanEditContext.Provider>
  )
}

export function useCanEdit(): boolean {
  return useContext(CanEditContext)
}

export function useCanManage(): boolean {
  return useContext(CanManageContext)
}
