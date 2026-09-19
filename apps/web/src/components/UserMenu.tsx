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
} from '@testmaker/ui'
import { ROLE_LABELS, type Role } from '@/lib/role'

/**
 * Kdo je přihlášený a odhlášení. Ve sborovně se u jednoho počítače vystřídá
 * víc lidí, takže jméno musí být vidět dřív, než někdo začne pracovat pod
 * cizím účtem.
 */
export function UserMenu({ jmeno, role, email }: { jmeno: string; role: Role; email: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function odhlasit() {
    setBusy(true)
    await fetch('/api/logout', { method: 'POST' })
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
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/zmena-hesla')}>Změnit heslo</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => void odhlasit()}>
          <LogOut className="size-4" />
          {busy ? 'Odhlašuji…' : 'Odhlásit se'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
