'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, UserRound } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import type { Role } from '@/lib/role'

/**
 * Who is signed in, and signing out. In the staff room several people take
 * turns at one computer, so the name must be visible before someone starts
 * working under another person's account.
 */
export function UserMenu({
  name,
  role,
  email,
  hasPassword,
}: {
  name: string
  role: Role
  email: string
  /** A Google-only account has no password — changing it would always end with "does not match". */
  hasPassword: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOutEverywhere() {
    setBusy(true)
    try {
      const response = await fetch('/api/logout', { method: 'POST' })
      if (!response.ok) throw new Error()
    } catch {
      // On a shared computer it is worse to think you are signed out and not be.
      toast.error(t('auth:signOut.failed'))
      setBusy(false)
      return
    }
    // `replace`, so the signed-out user cannot come back with the browser's back button.
    router.replace('/login')
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <UserRound className="size-4" />
          <span className="max-w-40 truncate">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm text-fg">{email}</span>
          <span className="block text-xs text-fg-muted">{t(`admin:roles.${role}`)}</span>
          {hasPassword ? null : (
            <span className="mt-1 block text-xs text-fg-muted">{t('auth:userMenu.googleOnly')}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hasPassword ? (
          <DropdownMenuItem onSelect={() => router.push('/zmena-hesla')}>{t('auth:userMenu.changePassword')}</DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={busy}
          onSelect={(event) => {
            // The menu stays open until signing out finishes — otherwise an
            // error would arrive when it is no longer clear what it belongs to.
            event.preventDefault()
            void signOutEverywhere()
          }}
        >
          <LogOut className="size-4" />
          {busy ? t('auth:signOut.busy') : t('auth:signOut.action')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
