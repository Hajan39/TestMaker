import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Question, QuestionStatus } from '@testmaker/core/schema'
import { db, grades, questions, subjects, topics } from '@/db'
import { inSchool, type Scope } from './user'
import { toQuestion } from './questions'

export interface PickerTopic {
  id: string
  label: string
  subject: string
  grade: string
  /** The topic's grade — the test editor pre-filters the bank to the test's class by it. */
  gradeId: string
  name: string
  questions: Question[]
}

/**
 * Questions grouped by topic for picking into a test.
 *
 * By default only approved ones: what the teacher rejected or hasn't checked
 * yet has no way to slip into a test. If everything were sent here and
 * filtered only in the browser, approval would be decoration — unticking a
 * checkbox would be enough.
 *
 * `statuses` serves the bank overview (`/questions`), which on the contrary
 * should show drafts and rejected ones too, so it's visible what is where.
 *
 * A test is composed across subjects and grades, so the whole library is loaded.
 *
 * Note on data size: `blocks` and `explanation` are not left out, even though
 * at first sight they look like needless weight. `blocks` is rendered by
 * `PaperQuestion` (images in the prompt) and `explanation` is shown in the
 * preview next to the sample answer — both right in the test builder, so
 * without them images and answer-key notes would silently vanish from the test.
 */
export async function loadPickerTopics(
  scope: Scope,
  options: { statuses?: QuestionStatus[] } = {},
): Promise<PickerTopic[]> {
  const statuses = options.statuses ?? ['approved']

  const rows = await db
    .select({
      topicId: topics.id,
      topicName: topics.name,
      gradeId: grades.id,
      gradeName: grades.name,
      subjectName: subjects.name,
      question: questions,
    })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(inSchool(scope, questions), inArray(questions.status, statuses)))
    .orderBy(asc(subjects.name), asc(grades.position), asc(topics.name), asc(questions.createdAt))

  const byTopic = new Map<string, PickerTopic>()
  for (const row of rows) {
    let entry = byTopic.get(row.topicId)
    if (!entry) {
      entry = {
        id: row.topicId,
        label: [row.subjectName, row.gradeName, row.topicName].filter(Boolean).join(' · '),
        subject: row.subjectName,
        grade: row.gradeName,
        gradeId: row.gradeId,
        name: row.topicName,
        questions: [],
      }
      byTopic.set(row.topicId, entry)
    }
    entry.questions.push(toQuestion(row.question))
  }

  return [...byTopic.values()]
}
