'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BusyButton, Button, Card, Input, Label, toast } from '@testmaker/ui'
import { errorMessage, fetchOrOffline, jsonBody, readJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (newPassword !== repeatPassword) {
      setError(t('auth:changePassword.mismatch'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetchOrOffline('/api/zmena-hesla', jsonBody('POST', { oldPassword, newPassword }), t('auth:changePassword.failed'))
      const data = await readJson(response)
      // 401 here means a wrong current password, not an expired session — the server message wins.
      if (!response.ok) throw new Error(data.error ?? `${t('auth:changePassword.failed')} ${t('common:errors.serverTrouble')}`)
      toast.success(t('auth:changePassword.changed'))
      router.push('/')
      router.refresh()
    } catch (submitError) {
      setError(errorMessage(submitError, t('auth:changePassword.failed')))
      setBusy(false)
    }
  }

  /** A way out even without a new password — e.g. when someone else sits at the computer. */
  async function signOutEverywhere() {
    setSigningOut(true)
    try {
      const response = await fetch('/api/logout', { method: 'POST' })
      if (!response.ok) throw new Error()
    } catch {
      toast.error(t('auth:signOut.failed'))
      setSigningOut(false)
      return
    }
    router.replace('/login')
    router.refresh()
  }

  return (
    <Card className="mx-auto max-w-sm p-6">
      <h1 className="text-lg font-semibold text-fg">{t('auth:changePassword.title')}</h1>
      <p className="mt-1 text-sm text-fg-soft">
        {t('auth:changePassword.intro')}
        {forced ? ` ${t('auth:changePassword.forcedHint')}` : null}
      </p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div>
          <Label htmlFor="stare">{t('auth:changePassword.current')}</Label>
          <Input
            id="stare"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={oldPassword}
            onChange={(event) => setOldPassword(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="nove">{t('auth:changePassword.new')}</Label>
          <Input
            id="nove"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="znovu">{t('auth:changePassword.repeat')}</Label>
          <Input
            id="znovu"
            type="password"
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(event) => setRepeatPassword(event.target.value)}
          />
        </div>
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <BusyButton type="submit" busy={busy} busyLabel={t('common:actions.saving')} disabled={newPassword.length === 0}>
            {t('auth:changePassword.save')}
          </BusyButton>
          {forced ? null : (
            <Button variant="ghost" asChild>
              <Link href="/">{t('common:actions.back')}</Link>
            </Button>
          )}
          <BusyButton
            type="button"
            variant="ghost"
            className="ml-auto"
            busy={signingOut}
            busyLabel={t('auth:signOut.busy')}
            onClick={() => void signOutEverywhere()}
          >
            {t('auth:signOut.action')}
          </BusyButton>
        </div>
      </form>
    </Card>
  )
}
