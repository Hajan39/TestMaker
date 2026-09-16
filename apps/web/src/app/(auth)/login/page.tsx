'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Input, Label } from '@testmaker/ui'

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setBusy(false)
    if (!response.ok) {
      const detail = (await response.json()) as { error?: string }
      setError(detail.error ?? 'Přihlášení se nezdařilo.')
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <Card className="mx-auto max-w-sm p-6">
      <h1 className="text-lg font-semibold text-fg">Přihlášení</h1>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div>
          <Label htmlFor="password">Heslo</Label>
          <Input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy || password.length === 0}>
          Přihlásit se
        </Button>
      </form>
    </Card>
  )
}
