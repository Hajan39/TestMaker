import { PageShell } from '@testmaker/ui'
import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTemplates } from '@/lib/tests'
import { TestBuilder } from '@/components/TestBuilder'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nový test – TestMaker' }

export default async function NewTestPage() {
  const ucet = await ucetStranky()
  const [topics, templates] = await Promise.all([loadPickerTopics(ucet), loadTemplates(ucet)])
  return (
    <PageShell>
      <TestBuilder topics={topics} templates={templates} test={null} items={[]} />
    </PageShell>
  )
}
