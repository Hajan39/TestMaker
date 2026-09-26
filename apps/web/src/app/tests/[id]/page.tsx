import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { PageShell } from '@testmaker/ui'
import { db, grades, subjects, topics } from '@/db'
import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTemplates, loadTest, loadTestItems } from '@/lib/tests'
import { TestBuilder } from '@/components/TestBuilder'
import { skola, ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'

export default async function TestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tema?: string }>
}) {
  const ucet = await ucetStranky()
  const { id } = await params
  const { tema } = await searchParams
  // Cizí písemka tu prostě není — `loadTest` pustí jen vlastní a nasdílené.
  const test = await loadTest(ucet, id)
  if (!test) notFound()

  const [pickerTopics, templates, items, gradeRow, backTopicRow] = await Promise.all([
    loadPickerTopics(ucet),
    loadTemplates(ucet),
    loadTestItems(ucet, id, { ownerId: test.ownerId }),
    test.gradeId
      ? db
          .select({ subjectName: subjects.name, gradeName: grades.name })
          .from(grades)
          .innerJoin(subjects, eq(subjects.id, grades.subjectId))
          .where(and(eq(grades.id, test.gradeId), skola(ucet, grades)))
          .limit(1)
      : Promise.resolve([]),
    // `?tema=` se ověří proti škole — cizí nebo neexistující téma se má tvářit
    // jako žádný parametr, ne jako chyba.
    tema
      ? db
          .select({ id: topics.id, name: topics.name })
          .from(topics)
          .where(and(eq(topics.id, tema), skola(ucet, topics)))
          .limit(1)
      : Promise.resolve([]),
  ])

  const gradeLabel = gradeRow[0] ? `${gradeRow[0].subjectName} · ${gradeRow[0].gradeName}` : null
  const backTopic = backTopicRow[0] ?? null

  return (
    <PageShell>
      <TestBuilder
        topics={pickerTopics}
        templates={templates}
        test={test}
        items={items}
        gradeId={test.gradeId}
        gradeLabel={gradeLabel}
        backTopic={backTopic}
      />
    </PageShell>
  )
}
