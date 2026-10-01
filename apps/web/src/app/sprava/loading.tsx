import { t } from '@testmaker/core/i18n'
import { Delayed, LoadingTable, LoadingHeading, PageShell } from '@testmaker/ui'

/** Transition to school management: a single-page skeleton, not the library's three columns. */
export default function ManagementLoading() {
  return (
    <PageShell>
      <Delayed label={t('admin:management.loading')} className="space-y-5">
        <LoadingHeading />
        <LoadingTable rows={6} columns={4} />
      </Delayed>
    </PageShell>
  )
}
