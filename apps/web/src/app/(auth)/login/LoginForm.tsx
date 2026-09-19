'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, Input, Label } from '@testmaker/ui'

export function LoginForm({ googleZapnuty }: { googleZapnuty: boolean }) {
  const router = useRouter()
  const parametry = useSearchParams()
  // Kam uživatelka mířila, než ji brána poslala sem.
  const dal = parametry.get('dal') || '/'
  const chybaZGoogle = parametry.get('chyba')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(chybaZGoogle)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    setBusy(false)
    if (!response.ok) {
      const detail = (await response.json()) as { error?: string }
      setError(detail.error ?? 'Přihlášení se nezdařilo.')
      return
    }
    const { mustChangePassword } = (await response.json()) as { mustChangePassword?: boolean }
    router.push(mustChangePassword ? '/zmena-hesla' : dal)
    router.refresh()
  }

  return (
    <Card className="mx-auto max-w-sm p-6">
      <h1 className="text-lg font-semibold text-fg">Přihlášení</h1>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div>
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="password">Heslo</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy || email.length === 0 || password.length === 0}>
          Přihlásit se
        </Button>
      </form>

      {googleZapnuty ? (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-fg-muted">
            <span className="h-px flex-1 bg-line" />
            nebo
            <span className="h-px flex-1 bg-line" />
          </div>
          {/*
            Obyčejný odkaz, ne `fetch`: přihlášení přes Google je přesměrování
            na cizí stránku a zpátky, takže se musí odehrát v adresním řádku.
          */}
          <Button asChild variant="outline" className="w-full">
            <a href={`/api/prihlaseni/google?dal=${encodeURIComponent(dal)}`}>
              Přihlásit se účtem Google
            </a>
          </Button>
        </>
      ) : null}
    </Card>
  )
}
