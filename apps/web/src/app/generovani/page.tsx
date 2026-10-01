import { PageShell } from '@testmaker/ui'
import { aiStatus } from '@/lib/ai'
import { countJobs, loadJobs } from '@/lib/jobs'
import { QueueScreen } from './QueueScreen'
import { pageAccount } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const dynamic = 'force-dynamic'

export function generateMetadata() {
  return { title: t('generation:queue.metaTitle') }
}

/**
 * Generation overview: what is being created, what waits, what is done and
 * what failed.
 *
 * The toolbar indicator leads here, so one can leave the topic or close bulk
 * generation and still stay informed. Data loads on the server so the overview
 * shows right away; then the screen refreshes it itself while something is happening.
 */
export default async function QueuePage() {
  const account = await pageAccount()
  const [jobs, counts] = await Promise.all([loadJobs(account), countJobs(account)])

  return (
    <PageShell>
      <QueueScreen initialJobs={jobs} initialCounts={counts} aiConfigured={aiStatus().configured} />
    </PageShell>
  )
}
