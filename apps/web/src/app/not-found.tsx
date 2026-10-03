import Link from 'next/link'
import { Button, EmptyState } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * Generic 404 for addresses outside topics and classes (those have their own,
 * more specific message) — e.g. a typo in the address or an old link to a
 * removed page.
 */
export default function NotFound() {
  return (
    <div className="p-5" data-testid="not-found-page">
      <EmptyState
        title={t('auth:shell.notFoundTitle')}
        hint={t('auth:shell.notFoundHint')}
        action={
          <Link href="/">
            <Button>{t('common:actions.home')}</Button>
          </Link>
        }
      />
    </div>
  )
}
