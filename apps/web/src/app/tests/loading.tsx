import { t } from '@testmaker/core/i18n'
import { Delayed, LoadingHeading, LoadingTable, PageShell } from '@testmaker/ui'

/** Transition to the test list: a table skeleton with the same rows as the real one. */
export default function TestsLoading() {
  return (
    <PageShell>
      <Delayed label={t('tests:loading.list')} className="space-y-5">
        <LoadingHeading />
        <LoadingTable rows={5} columns={6} />
      </Delayed>
    </PageShell>
  )
}
