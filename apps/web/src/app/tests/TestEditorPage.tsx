import { and, eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import type { TestKind } from '@testmaker/core/schema'
import { PageShell } from '@testmaker/ui'
import { db, grades, subjects, topics } from '@/db'
import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTemplates, loadTest, loadTestItems } from '@/lib/tests'
import { TestBuilder } from '@/components/TestBuilder'
import { inSchool, pageAccount } from '@/lib/user'
import { aiStatus } from '@/lib/ai'
import { testPath } from './paths'

/**
 * Editor of both a written test and a worksheet. A detail opened via the wrong
 * route (worksheet under `/tests`, test under `/listy`) redirects to the right one.
 */
export async function TestEditorPage({
  id,
  kind,
  topic,
  skipped,
}: {
  id: string
  kind: TestKind
  /** `?tema=` — the topic the test was created from (back link). */
  topic?: string
  /** `?vynechano=` — how many items the model skipped when generating the worksheet. */
  skipped?: string
}) {
  const account = await pageAccount()
  // Someone else's test simply isn't here — `loadTest` only lets through own and shared ones.
  const test = await loadTest(account, id)
  if (!test) notFound()
  if (test.kind !== kind) redirect(testPath(test.kind, id))

  const worksheet = test.kind === 'pracovni_list'
  const [pickerTopics, templates, items, gradeRow, backTopicRow] = await Promise.all([
    // No bank for a worksheet — its items neither belong there nor come from it.
    worksheet ? Promise.resolve([]) : loadPickerTopics(account),
    loadTemplates(account),
    loadTestItems(account, id, { ownerId: test.ownerId }),
    test.gradeId
      ? db
          .select({ subjectName: subjects.name, gradeName: grades.name })
          .from(grades)
          .innerJoin(subjects, eq(subjects.id, grades.subjectId))
          .where(and(eq(grades.id, test.gradeId), inSchool(account, grades)))
          .limit(1)
      : Promise.resolve([]),
    // `?tema=` (for a worksheet its own topic) is checked against the school — a
    // foreign or missing topic behaves as none.
    (worksheet ? test.topicId : topic)
      ? db
          .select({ id: topics.id, name: topics.name })
          .from(topics)
          .where(and(eq(topics.id, (worksheet ? test.topicId : topic)!), inSchool(account, topics)))
          .limit(1)
      : Promise.resolve([]),
  ])

  const gradeLabel = gradeRow[0] ? `${gradeRow[0].subjectName} · ${gradeRow[0].gradeName}` : null
  const backTopic = backTopicRow[0] ?? null
  const dropped = Number(skipped) || 0

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
        role={account.role}
        ai={aiStatus()}
        dropped={worksheet && dropped > 0 ? dropped : 0}
        mine={test.ownerId === account.userId}
      />
    </PageShell>
  )
}
