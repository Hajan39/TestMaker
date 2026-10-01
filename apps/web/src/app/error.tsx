'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { t } from '@testmaker/core/i18n'
import { Button, EmptyState } from '@testmaker/ui'

/**
 * Shown instead of the English Next.js default when a page fails to load
 * (typically the database or server). The top bar and navigation stay, so the
 * teacher can retry or go elsewhere.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="p-5">
      <EmptyState
        title={t('errors.pageLoadTitle')}
        hint={error.digest ? t('errors.loadHintWithCode', { code: error.digest }) : t('errors.loadHint')}
        action={
          <div className="flex gap-2">
            <Button onClick={() => retry()}>{t('actions.retry')}</Button>
            <Link href="/">
              <Button variant="outline">{t('actions.home')}</Button>
            </Link>
          </div>
        }
      />
    </div>
  )
}
