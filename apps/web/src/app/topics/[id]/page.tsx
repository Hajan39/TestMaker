import { asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StatRow } from '@testmaker/ui'
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

  const draftCount = questionList.filter((question) => question.status === 'draft').length

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-fg-muted">
          <Link href="/" className="hover:text-brand">
            {topic.subjectName}
          </Link>
          {topic.gradeName ? ` · ${topic.gradeName}` : ''}
        </p>
        <h1 className="ui-page-title mt-1">{topic.name}</h1>
      </div>

      <StatRow
        items={[
          { value: materialRows.length, label: 'materiálů' },
          { value: questionList.length, label: 'otázek' },
          { value: draftCount, label: 'ke schválení', tone: 'draft' },
        ]}
      />

      <TopicWorkspace
        topicId={topic.id}
        topicName={topic.name}
        materials={materialRows.filter((material) => !material.duplicateOfId)}
        questions={questionList}
        ai={aiStatus()}
        // `key` kvůli varování Reactu: prvek vzniklý na serveru a předaný
        // klientské komponentě jako prop se přenáší jako položka seznamu.
        group={<TopicGroup key="skupina" topicId={topic.id} topicName={topic.name} materials={materialRows} />}
      />
    </div>
  )
}
