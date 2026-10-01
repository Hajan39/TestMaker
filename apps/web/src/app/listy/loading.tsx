import { t } from '@testmaker/core/i18n'
import { Delayed, LoadingHeading, LoadingTable, PageShell } from '@testmaker/ui'

/** Transition to the worksheet list: a table skeleton with the same rows as the real one. */
export default function WorksheetsLoading() {
  return (
    <PageShell>
      <Delayed label={t('worksheets:loading.list')} className="space-y-5">
        <LoadingHeading />
        <LoadingTable rows={5} columns={5} />
      </Delayed>
    </PageShell>
  )
}
