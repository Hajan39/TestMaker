'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, Input, Label } from '@testmaker/ui'
import { safeReturnPath } from '@/lib/returnPath'
import { errorMessage, fetchOrOffline, jsonBody, readJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter()
  const parameters = useSearchParams()
  // Where the user was heading before the gate sent her here — in-app paths only.
  const next = safeReturnPath(parameters.get('dal'))
  const googleError = parameters.get('chyba')
  const googleInfo = parameters.get('info')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(googleError)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetchOrOffline('/api/login', jsonBody('POST', { email, password }), t('auth:login.failed'))
      const data = await readJson<{ mustChangePassword: boolean }>(response)
      // 401 here means a wrong password, not an expired session — the server message wins.
      if (!response.ok) throw new Error(data.error ?? `${t('auth:login.failed')} ${t('common:errors.serverTrouble')}`)
      router.push(data.mustChangePassword ? '/zmena-hesla' : next)
      router.refresh()
    } catch (submitError) {
      setError(errorMessage(submitError, t('auth:login.failed')))
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto max-w-sm p-6">
      <h1 className="text-lg font-semibold text-fg">{t('auth:login.title')}</h1>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div>
          <Label htmlFor="email">{t('auth:login.email')}</Label>
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
          <Label htmlFor="password">{t('auth:login.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {googleInfo && !error ? (
          <p className="text-sm text-fg-soft" role="status">
            {googleInfo}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || email.length === 0 || password.length === 0}>
          {busy ? t('auth:login.signingIn') : t('auth:login.signIn')}
        </Button>
      </form>

      {googleEnabled ? (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-fg-muted">
            <span className="h-px flex-1 bg-line" />
            {t('auth:login.or')}
            <span className="h-px flex-1 bg-line" />
          </div>
          {/*
            A plain link, not `fetch`: Google sign-in redirects to a foreign
            page and back, so it has to happen in the address bar.
          */}
          <Button asChild variant="outline" className="w-full">
            <a href={`/api/prihlaseni/google?dal=${encodeURIComponent(next)}`}>
              {t('auth:login.google')}
            </a>
          </Button>
        </>
      ) : null}
    </Card>
  )
}
