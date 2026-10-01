import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { InlineName } from '@/components/InlineName'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import { RememberClass } from '@/components/RememberClass'
import { StatRow } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { db, grades, materials, subjects, topics } from '@/db'
import { aiStatus } from '@/lib/ai'
import { countQuestions, loadQuestions, loadVariantLinks } from '@/lib/questions'
import { loadTemplates, loadTestUsageForQuestions } from '@/lib/tests'
import { defaultTemplateId } from '@/components/test-builder/defaults'
import { isUsableMaterial } from '@/lib/materials'
import { TopicWorkspace } from './TopicWorkspace'
import { inSchool, pageAccount } from '@/lib/user'

export const dynamic = 'force-dynamic'

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await pageAccount()
  const { id } = await params

  const [topic] = await db
    .select({
      id: topics.id,
      name: topics.name,
      gradeId: topics.gradeId,
      gradeName: grades.name,
      subjectName: subjects.name,
      usableCharCount: topics.usableCharCount,
      lowContent: topics.lowContent,
    })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(inSchool(account, topics), eq(topics.id, id)))
    .limit(1)

  if (!topic) notFound()

  // Counts come from a query, not the list length: the list is cut off by a
  // limit and for a topic with a thousand questions the numbers on top would lie.
  const [materialRows, questionList, usableQuestionCount, rejectedCount, templates] = await Promise.all([
    db
      .select({
        id: materials.id,
        fileName: materials.fileName,
        charCount: materials.charCount,
        pageCount: materials.pageCount,
        needsOcr: materials.needsOcr,
        duplicateOfId: materials.duplicateOfId,
        duplicateScore: materials.duplicateScore,
        excluded: materials.excluded,
      })
      .from(materials)
      .where(and(inSchool(account, materials), eq(materials.topicId, id)))
      .orderBy(asc(materials.fileName)),
    // Rejected ones are not loaded into the list at all — the card would not
    // show them anyway and the teacher could neither edit nor restore them.
    loadQuestions(account, { topicIds: [id], statuses: ['draft', 'approved'] }),
    // The single count on top, also used for top-up generation — rejected
    // (deleted) ones do not count, otherwise deleting a card would not lower it.
    countQuestions(account, { topicId: id, statuses: ['draft', 'approved'] }),
    // Number of deleted (rejected) questions — for the „Smazané (N)" toggle
    // above the list, so the whole list need not be loaded just for a number.
    countQuestions(account, { topicId: id, statuses: ['rejected'] }),
    // Default template for a test created from the checked questions right in
    // the topic — the same choice as for a new test from scratch.
    loadTemplates(account),
  ])
  // Generation only gets the text of materials that are not a duplicate of
  // another, not manually excluded and not a scan without a text layer.
  const usable = materialRows.filter(isUsableMaterial)
  const usableCount = usable.length
  const totalChars = usable.reduce((sum, material) => sum + material.charCount, 0)

  // The „V testu: …" badge and the „Jen nepoužité v testu" filter on the
  // question card — only for tests this teacher can see (`visibleTest`).
  const usage = await loadTestUsageForQuestions(
    account,
    questionList.items.map((question) => question.id),
  )

  // Easier and harder versions by root — for the „Verze: …" row on the card.
  // Roots (not the questions themselves): a version's card needs to find its
  // siblings' versions too, not just its own, and `loadVariantLinks` looks up
  // by `variantOf`, not by `id`.
  const rootIds = [...new Set(questionList.items.map((question) => question.variantOf ?? question.id))]
  const variantLinks = await loadVariantLinks(account, rootIds)

  return (
    <div className="space-y-5">
      <RememberClass gradeId={topic.gradeId} userId={account.userId} />
      <div>
        <p className="text-sm text-fg-muted">
          <Link href={`/tridy/${topic.gradeId}`} className="hover:text-brand">
            ← {topic.subjectName}
            {topic.gradeName ? ` · ${topic.gradeName}` : ''}
          </Link>
        </p>
        {/* Name and its actions on one row; numbers one level below, in a single
            place — material and question counts used to repeat in every card. */}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <InlineName
            kind="topic"
            id={topic.id}
            name={topic.name}
            as="h1"
            className="ui-page-title"
            label={t('library:topicPage.rename')}
          />
          <DeleteFromLibrary kind="topic" id={topic.id} iconOnly redirectTo="/" />
        </div>
      </div>

      <StatRow
        items={[
          { value: usableCount, label: t('library:word.materials', { count: usableCount }) },
          { value: totalChars.toLocaleString('cs'), label: t('library:topicPage.charsAvailable') },
          { value: usableQuestionCount, label: t('library:word.questions', { count: usableQuestionCount }) },
        ]}
      />

      <TopicWorkspace
        topic={{
          id: topic.id,
          name: topic.name,
          subjectName: topic.subjectName,
          gradeId: topic.gradeId,
          gradeName: topic.gradeName,
        }}
        defaultTemplateId={defaultTemplateId(templates)}
        materials={materialRows}
        questions={questionList.items}
        usage={usage}
        rejectedCount={rejectedCount}
        variantLinks={variantLinks}
        listTruncated={questionList.truncated}
        listLimit={questionList.limit}
        lowContent={topic.lowContent}
        usableCharCount={totalChars}
        ai={aiStatus()}
      />
    </div>
  )
}
