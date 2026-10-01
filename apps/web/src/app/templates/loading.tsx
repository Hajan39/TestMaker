import { t } from '@testmaker/core/i18n'
import { Delayed, LoadingCards, LoadingHeading, PageShell } from '@testmaker/ui'

/**
 * Transition to templates. Previews are real PDFs, so this is the slowest
 * screen of all — the skeleton keeps the A4 aspect ratio so the grid does not
 * reflow once the previews are drawn.
 */
export default function TemplatesLoading() {
  return (
    <PageShell>
      <Delayed label={t('tests:loading.templates')} className="space-y-5">
        <LoadingHeading />
        <LoadingCards count={3} />
      </Delayed>
    </PageShell>
  )
}
