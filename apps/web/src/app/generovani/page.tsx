import { PageShell } from '@testmaker/ui'
import { aiStatus } from '@/lib/ai'
import { countJobs, loadJobs } from '@/lib/jobs'
import { QueueScreen } from './QueueScreen'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Průběh generování – TestMaker' }

/**
 * Přehled generování: co se právě vytváří, co čeká, co je hotové a co se
 * nepovedlo.
 *
 * Do téhle obrazovky vede ukazatel v horní liště, takže se dá odejít z tématu
 * i zavřít hromadné generování a pořád být v obraze. Data se načtou na serveru,
 * ať je přehled vidět hned; dál si je obrazovka sama obnovuje, dokud se něco
 * děje.
 */
export default async function QueuePage() {
  const ucet = await ucetStranky()
  const [jobs, counts] = await Promise.all([loadJobs(ucet), countJobs(ucet)])

  return (
    <PageShell>
      <QueueScreen initialJobs={jobs} initialCounts={counts} aiConfigured={aiStatus().configured} />
    </PageShell>
  )
}
