import { notFound } from 'next/navigation'
import { PageShell } from '@testmaker/ui'
import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTemplates, loadTest, loadTestItems } from '@/lib/tests'
import { TestBuilder } from '@/components/TestBuilder'

export const dynamic = 'force-dynamic'

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const test = await loadTest(id)
  if (!test) notFound()

  const [topics, templates, items] = await Promise.all([
    loadPickerTopics(),
    loadTemplates(),
    loadTestItems(id),
  ])

  return (
    <PageShell>
      <TestBuilder topics={topics} templates={templates} test={test} items={items} />
    </PageShell>
  )
}
