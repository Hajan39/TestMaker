import { Suspense } from 'react'
import { googleSettings } from '@/lib/google'
import { t } from '@testmaker/core/i18n'
import { LoginForm } from './LoginForm'

export function generateMetadata() {
  return { title: t('auth:login.metaTitle') }
}

export default function LoginPage() {
  // The Google button is offered only when configured — same rule as for
  // generation: what cannot be used is not shown.
  const googleEnabled = googleSettings() !== null

  return (
    // `useSearchParams` in the form needs a Suspense boundary.
    <Suspense>
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  )
}
