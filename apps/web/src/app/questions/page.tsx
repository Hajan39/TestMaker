import Link from 'next/link'
import { Button, Card, EmptyState, QuestionPreview } from '@testmaker/ui'
import { loadPickerTopics } from '@/lib/questionPicker'

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
            <Button variant="primary">Přejít na přehled</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink-900">Banka otázek ({total})</h1>
        <Link href="/tests/new">
          <Button variant="primary">Poskládat test</Button>
        </Link>
      </div>

      <div className="space-y-3">
        {topics.map((topic) => (
          <Card key={topic.id} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-900">{topic.label}</h2>
              <Link href={`/topics/${topic.id}`} className="text-sm text-brand-700 hover:underline">
                Otevřít téma
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-ink-100">
              {topic.questions.slice(0, 5).map((question) => (
                <li key={question.id} className="py-2">
                  <QuestionPreview question={question} showAnswers={false} />
                </li>
              ))}
            </ul>
            {topic.questions.length > 5 ? (
              <p className="mt-2 text-sm text-ink-500">a dalších {topic.questions.length - 5}…</p>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  )
}
