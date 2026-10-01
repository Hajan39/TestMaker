'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, Input, Label } from '@testmaker/ui'
import { bezpecnyNavrat } from '@/lib/navrat'
import { errorMessage, fetchOrOffline, jsonBody, readJson, SERVER_TROUBLE } from '@/lib/requestJson'

export function LoginForm({ googleZapnuty }: { googleZapnuty: boolean }) {
  const router = useRouter()
  const parametry = useSearchParams()
  // Kam uživatelka mířila, než ji brána poslala sem — jen uvnitř aplikace.
  const dal = bezpecnyNavrat(parametry.get('dal'))
  const chybaZGoogle = parametry.get('chyba')
  const infoZGoogle = parametry.get('info')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(chybaZGoogle)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetchOrOffline('/api/login', jsonBody('POST', { email, password }), 'Přihlášení se nezdařilo.')
      const data = await readJson<{ mustChangePassword: boolean }>(response)
      // 401 tu znamená špatné heslo, ne vypršelé přihlášení — hláška serveru má přednost.
      if (!response.ok) throw new Error(data.error ?? `Přihlášení se nezdařilo. ${SERVER_TROUBLE}`)
      router.push(data.mustChangePassword ? '/zmena-hesla' : dal)
      router.refresh()
    } catch (submitError) {
      setError(errorMessage(submitError, 'Přihlášení se nezdařilo.'))
      setBusy(false)
    }
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
        {infoZGoogle && !error ? (
          <p className="text-sm text-fg-soft" role="status">
            {infoZGoogle}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || email.length === 0 || password.length === 0}>
          {busy ? 'Přihlašuji…' : 'Přihlásit se'}
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
