import { Delayed, LoadingHeading, LoadingTable, PageShell } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/** Transition to the generation overview: a skeleton of the topic list with the same rows. */
export default function QueueLoading() {
  return (
    <PageShell>
      <Delayed label={t('generation:queue.loading')} className="space-y-5">
        <LoadingHeading stats />
        <LoadingTable rows={5} columns={3} />
      </Delayed>
    </PageShell>
  )
}
