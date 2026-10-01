import { AI_SETTINGS } from '@testmaker/core/ai'
import { EmptyState, PageShell } from '@testmaker/ui'
import { aiStatus } from '@/lib/ai'
import { loadLibraryTree } from '@/lib/library'
import { loadTemplates } from '@/lib/tests'
import { ucetStranky } from '@/lib/uzivatel'
import { NewWorksheetForm, type WorksheetSubject } from './NewWorksheetForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nový pracovní list – TestMaker' }

export default async function NewWorksheetPage() {
  const ucet = await ucetStranky()
  const [tree, templates] = await Promise.all([loadLibraryTree(ucet), loadTemplates(ucet)])
  // Do prohlížeče jen to, co formulář potřebuje: názvy a id pater knihovny.
  const subjects: WorksheetSubject[] = tree.map((subject) => ({
    id: subject.id,
    name: subject.name,
    grades: subject.grades.map((grade) => ({
      id: grade.id,
      name: grade.name,
      topics: grade.topics.map((topic) => ({ id: topic.id, name: topic.name })),
    })),
  }))
  const { configured, problems } = aiStatus()
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
      <NewWorksheetForm
        subjects={subjects}
        templateId={templates[0]?.id ?? ''}
        ai={{ configured, problems }}
        limits={{ instructionsMax: AI_SETTINGS.worksheet.instructionsMax, ownTextMax: AI_SETTINGS.worksheet.ownTextMax }}
      />
    </PageShell>
  )
}
