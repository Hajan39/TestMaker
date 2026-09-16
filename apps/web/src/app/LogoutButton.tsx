'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@testmaker/ui'

/**
 * Odhlášení. Nesedí v liště v `packages/ui` schválně — lišta je sdílená
 * komponenta, kdežto přihlašování je věc téhle aplikace. Drží se proto
 * v rohu okna a zobrazuje se jen tam, kde je přihlašování zapnuté.
 */
export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function logout() {
    setBusy(true)
    await fetch('/api/logout', { method: 'POST' })
    // `replace`, ať se odhlášená uživatelka nevrátí zpátky tlačítkem prohlížeče.
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="fixed bottom-3 left-3 z-50">
      <Button variant="ghost" size="sm" onClick={logout} disabled={busy}>
        {busy ? 'Odhlašuji…' : 'Odhlásit se'}
      </Button>
    </div>
  )
}
