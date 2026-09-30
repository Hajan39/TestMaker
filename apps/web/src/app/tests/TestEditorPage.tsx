import { and, eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import type { TestKind } from '@testmaker/core/schema'
import { PageShell } from '@testmaker/ui'
import { db, grades, subjects, topics } from '@/db'
import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTemplates, loadTest, loadTestItems } from '@/lib/tests'
import { TestBuilder } from '@/components/TestBuilder'
import { skola, ucetStranky } from '@/lib/uzivatel'
import { aiStatus } from '@/lib/ai'
import { testPath } from './paths'

/**
 * Editor písemky i pracovního listu. Detail otevřený přes nesprávnou trasu
 * (list pod `/tests`, písemka pod `/listy`) přesměruje na tu správnou.
 */
export async function TestEditorPage({
  id,
  kind,
  tema,
  vynechano,
}: {
  id: string
  kind: TestKind
  /** `?tema=` — téma, ze kterého písemka vznikla (odkaz zpět). */
  tema?: string
  /** `?vynechano=` — kolik položek model po vygenerování listu vynechal. */
  vynechano?: string
}) {
  const ucet = await ucetStranky()
  // Cizí písemka tu prostě není — `loadTest` pustí jen vlastní a nasdílené.
  const test = await loadTest(ucet, id)
  if (!test) notFound()
  if (test.kind !== kind) redirect(testPath(test.kind, id))

  const worksheet = test.kind === 'pracovni_list'
  const [pickerTopics, templates, items, gradeRow, backTopicRow] = await Promise.all([
    // Banka se u listu nenabízí — úlohy listu do ní nepatří a ani z ní nejsou.
    worksheet ? Promise.resolve([]) : loadPickerTopics(ucet),
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
    // `?tema=` (u listu jeho vlastní téma) se ověří proti škole — cizí nebo
    // neexistující téma se má tvářit jako žádné.
    (worksheet ? test.topicId : tema)
      ? db
          .select({ id: topics.id, name: topics.name })
          .from(topics)
          .where(and(eq(topics.id, (worksheet ? test.topicId : tema)!), skola(ucet, topics)))
          .limit(1)
      : Promise.resolve([]),
  ])

  const gradeLabel = gradeRow[0] ? `${gradeRow[0].subjectName} · ${gradeRow[0].gradeName}` : null
  const backTopic = backTopicRow[0] ?? null
  const dropped = Number(vynechano) || 0

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
        role={ucet.role}
        ai={aiStatus()}
        dropped={worksheet && dropped > 0 ? dropped : 0}
      />
    </PageShell>
  )
}
