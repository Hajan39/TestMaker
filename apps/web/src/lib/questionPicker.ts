import 'server-only'
import { asc, eq } from 'drizzle-orm'
import type { Question } from '@testmaker/core/schema'
import { db, grades, questions, subjects, topics } from '@/db'
import { toQuestion } from './questions'

export interface PickerTopic {
  id: string
  label: string
  subject: string
  grade: string
  name: string
  questions: Question[]
}

/**
 * Všechny otázky seskupené podle tématu pro výběr do testu.
 * Test se skládá napříč předměty i ročníky, proto se načítá celá knihovna.
 */
export async function loadPickerTopics(): Promise<PickerTopic[]> {
  const rows = await db
    .select({
      topicId: topics.id,
      topicName: topics.name,
      gradeName: grades.name,
      subjectName: subjects.name,
      question: questions,
    })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
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
        name: row.topicName,
        questions: [],
      }
      byTopic.set(row.topicId, entry)
    }
    entry.questions.push(toQuestion(row.question))
  }

  return [...byTopic.values()]
}
