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
import { ROLE_LABELS, type Role } from '@/lib/role'

/**
 * Kdo je přihlášený a odhlášení. Ve sborovně se u jednoho počítače vystřídá
 * víc lidí, takže jméno musí být vidět dřív, než někdo začne pracovat pod
 * cizím účtem.
 */
export function UserMenu({
  jmeno,
  role,
  email,
  maHeslo,
}: {
  jmeno: string
  role: Role
  email: string
  /** Účet jen přes Google heslo nemá — změna hesla by vždycky skončila „nesouhlasí“. */
  maHeslo: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function odhlasit() {
    setBusy(true)
    try {
      const response = await fetch('/api/logout', { method: 'POST' })
      if (!response.ok) throw new Error()
    } catch {
      // U sdíleného počítače je horší myslet si, že jsem odhlášená, a nebýt.
      toast.error('Odhlášení se nepovedlo, zkus to znovu.')
      setBusy(false)
      return
    }
    // `replace`, ať se odhlášená uživatelka nevrátí zpátky tlačítkem prohlížeče.
    router.replace('/login')
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <UserRound className="size-4" />
          <span className="max-w-40 truncate">{jmeno}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm text-fg">{email}</span>
          <span className="block text-xs text-fg-muted">{ROLE_LABELS[role]}</span>
          {maHeslo ? null : (
            <span className="mt-1 block text-xs text-fg-muted">Přihlašuješ se přes Google, heslo nemáš.</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {maHeslo ? (
          <DropdownMenuItem onSelect={() => router.push('/zmena-hesla')}>Změnit heslo</DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={busy}
          onSelect={(event) => {
            // Nabídka zůstane otevřená, dokud odhlášení neskončí — jinak by
            // chyba přišla, až by nebylo vidět, k čemu patří.
            event.preventDefault()
            void odhlasit()
          }}
        >
          <LogOut className="size-4" />
          {busy ? 'Odhlašuji…' : 'Odhlásit se'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
