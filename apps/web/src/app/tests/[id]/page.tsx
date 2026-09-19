import { notFound } from 'next/navigation'
import { PageShell } from '@testmaker/ui'
import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTemplates, loadTest, loadTestItems } from '@/lib/tests'
import { TestBuilder } from '@/components/TestBuilder'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const ucet = await ucetStranky()
  const { id } = await params
  // Cizí písemka tu prostě není — `loadTest` pustí jen vlastní a nasdílené.
  const test = await loadTest(ucet, id)
  if (!test) notFound()

  const [topics, templates, items] = await Promise.all([
    loadPickerTopics(ucet),
    loadTemplates(ucet),
    loadTestItems(ucet, id, { ownerId: test.ownerId }),
  ])

  return (
    <PageShell>
      <TestBuilder topics={topics} templates={templates} test={test} items={items} />
    </PageShell>
  )
}
