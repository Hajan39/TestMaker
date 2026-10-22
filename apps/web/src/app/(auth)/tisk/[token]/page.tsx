import { Card, EmptyState } from '@testmaker/ui'
import { formatDateTime } from '@testmaker/core/dates'
import { t } from '@testmaker/core/i18n'
import { resolveShareToken } from '@/lib/share'
import { loadTest } from '@/lib/tests'
import { SharedPrintActions } from './SharedPrintActions'

export function generateMetadata() {
  return { title: t('tests:share.page.metaTitle') }
}

// The token's expiry is checked on every visit.
export const dynamic = 'force-dynamic'

/**
 * Print link page for anyone without an account: the test title, how long the
 * link works, and print/download of the blank pupil version.
 */
export default async function SharedPrintPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const shared = await resolveShareToken(token)
  const test = shared ? await loadTest(shared.scope, shared.testId) : null

  if (!shared || !test) {
    return (
      <Card className="mx-auto max-w-md p-6" data-testid="share-expired">
        <EmptyState title={t('tests:share.page.expiredTitle')} hint={t('tests:share.page.expiredHint')} />
      </Card>
    )
  }

  return (
    <Card className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-lg font-semibold text-fg">{test.title}</h1>
      <p className="text-sm text-fg-soft" data-testid="share-valid-until">
        {t('tests:share.page.validUntil', { date: formatDateTime(shared.expiresAt) })}
      </p>
      <SharedPrintActions token={token} variants={test.variants} />
      <p className="text-xs text-fg-muted">{t('tests:share.pupilsOnly')}</p>
    </Card>
  )
}
