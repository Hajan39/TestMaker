import { asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card } from '@testmaker/ui'
import { db, grades, materials, subjects, topics } from '@/db'
import { aiStatus } from '@/lib/ai'
import { loadQuestions } from '@/lib/questions'
import { TopicWorkspace } from './TopicWorkspace'

export const dynamic = 'force-dynamic'

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [topic] = await db
    .select({
      id: topics.id,
      name: topics.name,
      gradeName: grades.name,
      subjectName: subjects.name,
    })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(eq(topics.id, id))
    .limit(1)

  if (!topic) notFound()

  const [materialRows, questionList] = await Promise.all([
    db
      .select({
        id: materials.id,
        fileName: materials.fileName,
        charCount: materials.charCount,
        pageCount: materials.pageCount,
        needsOcr: materials.needsOcr,
      })
      .from(materials)
      .where(eq(materials.topicId, id))
      .orderBy(asc(materials.fileName)),
    loadQuestions({ topicIds: [id] }),
  ])

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-ink-500">
          <Link href="/" className="hover:text-brand-700">
            {topic.subjectName}
          </Link>
          {topic.gradeName ? ` · ${topic.gradeName}` : ''}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-ink-900">{topic.name}</h1>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink-900">Materiály ({materialRows.length})</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {materialRows.map((material) => (
            <li key={material.id} className="flex flex-wrap items-center gap-2">
              <span className="text-ink-800">{material.fileName}</span>
              <span className="text-ink-400">
                {material.charCount.toLocaleString('cs')} znaků
                {material.pageCount ? `, ${material.pageCount} str.` : ''}
              </span>
              {material.needsOcr ? <Badge tone="warn">skoro bez textu</Badge> : null}
            </li>
          ))}
        </ul>
      </Card>

      <TopicWorkspace
        topicId={topic.id}
        materials={materialRows}
        questions={questionList}
        ai={aiStatus()}
      />
    </div>
  )
}
