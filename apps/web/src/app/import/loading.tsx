import { Delayed, LoadingCard, LoadingHeading, PageShell } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/** Transition to import: a single-page form over the library. */
export default function ImportLoading() {
  return (
    <PageShell>
      <Delayed label={t('library:import.loading')} className="space-y-5">
        <LoadingHeading />
        <LoadingCard lines={4} />
      </Delayed>
    </PageShell>
  )
}
