'use client'

import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BusyButton, Button, Card, Input, Label, toast } from '@testmaker/ui'
import { errorMessage, fetchOrOffline, jsonBody, readJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

/** The form's shape; built on each render so the messages follow the current language. */
function passwordSchema() {
  return z
    .object({
      oldPassword: z.string(),
      newPassword: z.string().min(1),
      repeatPassword: z.string(),
    })
    .refine((value) => value.newPassword === value.repeatPassword, {
      path: ['repeatPassword'],
      message: t('auth:changePassword.mismatch'),
    })
}
type PasswordForm = z.infer<ReturnType<typeof passwordSchema>>

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema()),
    defaultValues: { oldPassword: '', newPassword: '', repeatPassword: '' },
  })
  const newPassword = useWatch({ control, name: 'newPassword' })
  // One message under the form: a mismatch, or what the server said.
  const error = errors.repeatPassword?.message ?? errors.root?.message ?? null

  async function submit({ oldPassword, newPassword }: PasswordForm) {
    try {
      const response = await fetchOrOffline('/api/zmena-hesla', jsonBody('POST', { oldPassword, newPassword }), t('auth:changePassword.failed'))
      const data = await readJson(response)
      // 401 here means a wrong current password, not an expired session — the server message wins.
      if (!response.ok) throw new Error(data.error ?? `${t('auth:changePassword.failed')} ${t('common:errors.serverTrouble')}`)
      toast.success(t('auth:changePassword.changed'))
      router.push('/')
      router.refresh()
    } catch (submitError) {
      setError('root', { message: errorMessage(submitError, t('auth:changePassword.failed')) })
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
      <form className="mt-4 space-y-3" onSubmit={handleSubmit(submit)}>
        <div>
          <Label htmlFor="stare">{t('auth:changePassword.current')}</Label>
          <Input
            id="stare"
            type="password"
            autoComplete="current-password"
            autoFocus
            {...register('oldPassword')}
          />
        </div>
        <div>
          <Label htmlFor="nove">{t('auth:changePassword.new')}</Label>
          <Input
            id="nove"
            type="password"
            autoComplete="new-password"
            {...register('newPassword')}
          />
        </div>
        <div>
          <Label htmlFor="znovu">{t('auth:changePassword.repeat')}</Label>
          <Input
            id="znovu"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.repeatPassword ? true : undefined}
            {...register('repeatPassword')}
          />
        </div>
        {error ? (
          <p className="text-sm text-danger" role="alert" data-testid="password-error">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <BusyButton
            type="submit"
            busy={isSubmitting}
            busyLabel={t('common:actions.saving')}
            disabled={newPassword.length === 0}
          >
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
