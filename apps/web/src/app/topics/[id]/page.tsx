import { asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TopicGroup } from '@/components/TopicGroup'
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
        duplicateOfId: materials.duplicateOfId,
        duplicateScore: materials.duplicateScore,
      })
      .from(materials)
      .where(eq(materials.topicId, id))
      .orderBy(asc(materials.fileName)),
    loadQuestions({ topicIds: [id] }),
  ])

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-fg-muted">
          <Link href="/" className="hover:text-brand">
            {topic.subjectName}
          </Link>
          {topic.gradeName ? ` · ${topic.gradeName}` : ''}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-fg">{topic.name}</h1>
      </div>

      <TopicGroup topicId={topic.id} topicName={topic.name} materials={materialRows} />

      <TopicWorkspace
        topicId={topic.id}
        topicName={topic.name}
        materials={materialRows.filter((material) => !material.duplicateOfId)}
        questions={questionList}
        ai={aiStatus()}
      />
    </div>
  )
}
