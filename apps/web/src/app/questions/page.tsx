import Link from 'next/link'
import { Button, EmptyState, PageShell } from '@testmaker/ui'
import { loadPickerTopics } from '@/lib/questionPicker'
import { QuestionsTable } from './QuestionsTable'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Banka otázek – TestMaker' }

export default async function QuestionsPage() {
  const topics = await loadPickerTopics()
  const total = topics.reduce((sum, topic) => sum + topic.questions.length, 0)

  if (total === 0) {
    return (
      <EmptyState
        title="Banka otázek je prázdná"
        hint="Otevři téma a vygeneruj otázky z materiálu, nebo si napiš vlastní."
        action={
          <Link href="/">
            <Button>Přejít na přehled</Button>
          </Link>
        }
      />
    )
  }

  return (
    <PageShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="ui-page-title">Banka otázek ({total})</h1>
          <Link href="/tests/new">
            <Button>Poskládat test</Button>
          </Link>
        </div>

        <QuestionsTable topics={topics} />
      </div>
    </PageShell>
  )
}
