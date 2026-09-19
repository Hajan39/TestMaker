import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Question, QuestionStatus } from '@testmaker/core/schema'
import { db, grades, questions, subjects, topics } from '@/db'
import { skola, type Scope } from './uzivatel'
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
 * Otázky seskupené podle tématu pro výběr do testu.
 *
 * Ve výchozím stavu jen schválené: co učitelka zamítla nebo zatím
 * nezkontrolovala, nemá do písemky kudy proklouznout. Kdyby se sem posílalo
 * všechno a odfiltrovávalo se to až v prohlížeči, bylo by schvalování jen
 * ozdoba — stačilo by odškrtnout zaškrtávátko.
 *
 * `statuses` je tu pro přehled banky (`/questions`), který naopak má ukazovat
 * i koncepty a zamítnuté, ať je vidět, co kde leží.
 *
 * Test se skládá napříč předměty i ročníky, proto se načítá celá knihovna.
 *
 * Poznámka k rozsahu dat: `blocks` ani `explanation` se nevynechávají, i když
 * to na první pohled vypadá jako zbytečná zátěž. `blocks` vykresluje
 * `PaperQuestion` (obrázky u zadání) a `explanation` se ukazuje v náhledu
 * u vzorové odpovědi — obojí přímo ve skladači testu, takže bez nich by se
 * v písemce tiše ztratily obrázky a poznámky do klíče.
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
      gradeName: grades.name,
      subjectName: subjects.name,
      question: questions,
    })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(skola(scope, questions), inArray(questions.status, statuses)))
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
