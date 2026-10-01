import { EmptyState, PageShell } from '@testmaker/ui'
import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTemplates } from '@/lib/tests'
import { TestBuilder } from '@/components/TestBuilder'
import { ucetStranky } from '@/lib/uzivatel'
import { aiStatus } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nový test – TestMaker' }

export default async function NewTestPage() {
  const ucet = await ucetStranky()
  const [topics, templates] = await Promise.all([loadPickerTopics(ucet), loadTemplates(ucet)])
  // Bez šablony by uložení skončilo odmítnutím — řekne se to rovnou.
  if (templates.length === 0) {
    return (
      <PageShell>
        <EmptyState
          title="Nejdřív je potřeba šablona"
          hint="Ve škole zatím není žádná šablona pro tisk, takže nejde nic založit. Dej vědět správci, ať ji přidá."
        />
      </PageShell>
    )
  }
  return (
    <PageShell>
      <TestBuilder
        topics={topics}
        templates={templates}
        test={null}
        items={[]}
        role={ucet.role}
        ai={aiStatus()}
      />
    </PageShell>
  )
}
