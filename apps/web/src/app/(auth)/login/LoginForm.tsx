'use client'

import { useForm, useWatch } from 'react-hook-form'
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

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<{ email: string; password: string }>({ defaultValues: { email: '', password: '' } })
  const [email, password] = useWatch({ control, name: ['email', 'password'] })
  // A Google sign-in error from the URL shows until the first attempt here.
  const error = errors.root?.message ?? (isSubmitting || isSubmitSuccessful ? null : googleError)

  async function submit({ email, password }: { email: string; password: string }) {
    try {
      const response = await fetchOrOffline('/api/login', jsonBody('POST', { email, password }), t('auth:login.failed'))
      const data = await readJson<{ mustChangePassword: boolean }>(response)
      // 401 here means a wrong password, not an expired session — the server message wins.
      if (!response.ok) throw new Error(data.error ?? `${t('auth:login.failed')} ${t('common:errors.serverTrouble')}`)
      router.push(data.mustChangePassword ? '/zmena-hesla' : next)
      router.refresh()
    } catch (submitError) {
      setError('root', { message: errorMessage(submitError, t('auth:login.failed')) })
    }
  }

  return (
    <Card className="mx-auto max-w-sm p-6">
      <h1 className="text-lg font-semibold text-fg">{t('auth:login.title')}</h1>
      <form className="mt-4 space-y-3" onSubmit={handleSubmit(submit)}>
        <div>
          <Label htmlFor="email">{t('auth:login.email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            defaultValue=""
            {...register('email')}
          />
        </div>
        <div>
          <Label htmlFor="password">{t('auth:login.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            defaultValue=""
            {...register('password')}
          />
        </div>
        {googleInfo && !error ? (
          <p className="text-sm text-fg-soft" role="status">
            {googleInfo}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-danger" role="alert" data-testid="login-error">
            {error}
          </p>
        ) : null}
        {/* Stays busy after a successful sign-in until the next page loads. */}
        <Button type="submit" disabled={isSubmitting || isSubmitSuccessful || email.length === 0 || password.length === 0}>
          {isSubmitting || isSubmitSuccessful ? t('auth:login.signingIn') : t('auth:login.signIn')}
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
