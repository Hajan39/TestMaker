'use client'

import { useEffect } from 'react'
import { t } from '@testmaker/core/i18n'

/**
 * Last resort when even the root layout fails (loading the account or
 * schools). It replaces the whole document without the app's styles, hence
 * inline styles.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="cs">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '15vh auto', padding: '0 16px' }}>
        <title>{t('errors.appErrorTitle')}</title>
        <h1 style={{ fontSize: 20 }}>{t('errors.appLoadTitle')}</h1>
        <p style={{ lineHeight: 1.5 }}>
          {error.digest ? t('errors.loadHintWithCode', { code: error.digest }) : t('errors.loadHint')}
        </p>
        <button type="button" onClick={() => retry()} style={{ padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}>
          {t('actions.retry')}
        </button>
      </body>
    </html>
  )
}
