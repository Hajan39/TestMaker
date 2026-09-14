import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTemplates } from '@/lib/tests'
import { TestBuilder } from '@/components/TestBuilder'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nový test – TestMaker' }

export default async function NewTestPage() {
  const [topics, templates] = await Promise.all([loadPickerTopics(), loadTemplates()])
  return <TestBuilder topics={topics} templates={templates} test={null} items={[]} />
}
