import { currentUser } from '@/lib/user'
import { t } from '@testmaker/core/i18n'
import { ChangePasswordForm } from './ChangePasswordForm'

export function generateMetadata() {
  return { title: t('auth:changePassword.metaTitle') }
}

// Session state is read on every request; a prerendered page would not know it.
export const dynamic = 'force-dynamic'

/**
 * Changing one's own password. After a reset by a manager the gate lets the
 * user only here — a password someone else knows must not stay in use. Only
 * the server knows whether this is such a forced change; the way back is
 * offered accordingly.
 */
export default async function ChangePasswordPage() {
  const user = await currentUser()
  return <ChangePasswordForm forced={user?.mustChangePassword ?? false} />
}
