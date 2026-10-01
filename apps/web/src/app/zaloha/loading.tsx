import { Delayed, LoadingCard, LoadingHeading, PageShell } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/** Navigating to backup: all the school's tables are counted, it takes a moment. */
export default function BackupLoading() {
  return (
    <PageShell>
      <Delayed label={t('backup:loading')} className="space-y-5">
        <LoadingHeading />
        <LoadingCard lines={4} />
      </Delayed>
    </PageShell>
  )
}
