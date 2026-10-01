import { t } from '@testmaker/core/i18n'
import { Delayed, LoadingTable, LoadingHeading, PageShell } from '@testmaker/ui'

/** Transition to administration: the school and AI usage overviews are tables. */
export default function AdminLoading() {
  return (
    <PageShell>
      <Delayed label={t('admin:schools.loading')} className="space-y-5">
        <LoadingHeading />
        <LoadingTable rows={5} columns={4} />
      </Delayed>
    </PageShell>
  )
}
