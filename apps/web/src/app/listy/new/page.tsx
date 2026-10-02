import type { Metadata } from 'next'
import { t } from '@testmaker/core/i18n'
import { AI_SETTINGS } from '@testmaker/core/ai'
import { EmptyState, PageShell } from '@testmaker/ui'
import { aiStatus } from '@/lib/ai'
import { loadLibraryTree } from '@/lib/library'
import { loadTemplates } from '@/lib/tests'
import { defaultTemplateId } from '@/components/test-builder/defaults'
import { pageAccount } from '@/lib/user'
import { NewWorksheetForm, type WorksheetSubject } from './NewWorksheetForm'

export const dynamic = 'force-dynamic'
export function generateMetadata(): Metadata {
  return { title: t('worksheets:meta.new') }
}

export default async function NewWorksheetPage() {
  const account = await pageAccount()
  const [tree, templates] = await Promise.all([loadLibraryTree(account), loadTemplates(account)])
  // Send the browser only what the form needs: names and ids of the library levels.
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
  // Without a template saving would be rejected — say so up front.
  if (templates.length === 0) {
    return (
      <PageShell>
        <EmptyState title={t('tests:noTemplate.title')} hint={t('tests:noTemplate.hint')} />
      </PageShell>
    )
  }
  return (
    <PageShell>
      <NewWorksheetForm
        subjects={subjects}
        templateId={defaultTemplateId(templates, 'pracovni_list')}
        ai={{ configured, problems }}
        limits={{ instructionsMax: AI_SETTINGS.worksheet.instructionsMax, ownTextMax: AI_SETTINGS.worksheet.ownTextMax }}
      />
    </PageShell>
  )
}
