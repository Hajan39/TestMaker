import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, grades, materials, questions, subjects, testItems, tests, topics } from '@/db'
import { createLibraryItem, renameLibraryItem } from '@/lib/library'
import { canManage, withScope, inSchool, writeAudit, type Scope } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

const kindSchema = z.enum(['subject', 'grade', 'topic'])
type Kind = z.infer<typeof kindSchema>

/** Everything that disappears along with the selected item. */
export interface DeletionImpact {
  name: string
  grades: number
  topics: number
  materials: number
  questions: number
  /** Titles of saved tests that the questions will drop out of. */
  affectedTests: string[]
}

/**
 * Preview of a deletion's impact. Deleting in the library cascades — a subject
 * takes its grades, topics, materials and questions with it — so the teacher
 * must see beforehand what she'll lose.
 */
export async function GET(request: Request) {
  return withScope(async (account) => {
    const params = new URL(request.url).searchParams
    const kind = kindSchema.safeParse(params.get('kind'))
    const id = params.get('id')
    if (!kind.success || !id) return Response.json({ error: t('api:invalidRequest') }, { status: 400 })

    const impact = await measure(account, kind.data, id)
    if (!impact) return Response.json({ error: t('library:libraryApi.itemGone') }, { status: 404 })
    return Response.json(impact)
  })
}

const createSchema = z.object({
  kind: kindSchema,
  name: z.string().max(200),
  /** Subject for a grade, grade for a topic. Not set for a subject. */
  parentId: z.string().min(1).nullish(),
})

const renameSchema = z.object({
  kind: kindSchema,
  id: z.string().min(1),
  name: z.string().max(200),
})

/**
 * Creates a subject, grade or topic manually — without importing materials.
 * The teacher can prepare an empty topic and write her own questions into it.
 */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
      const parsed = createSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: t('api:invalidRequest') }, { status: 400 })

      const result = await createLibraryItem(account, parsed.data)
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
      return Response.json({ ok: true, id: result.id })
    },
    { write: true },
  )
}

/** Renames a subject, grade or topic. */
export async function PATCH(request: Request) {
  return withScope(
    async (account) => {
      const parsed = renameSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: t('api:invalidRequest') }, { status: 400 })

      const result = await renameLibraryItem(account, parsed.data)
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
      return Response.json({ ok: true, id: result.id })
    },
    { write: true },
  )
}

/**
 * Deletes a subject, grade or topic with everything below it.
 *
 * The library is shared, so this deletion touches colleagues' work — that's
 * why it's written to the audit log. A topic may be deleted by anyone who may
 * edit content (a topic is the unit a teacher works with as a whole); a
 * subject or grade, under which lies the whole school's work, only by an admin.
 */
export async function DELETE(request: Request) {
  return withScope(
    async (account) => {
      const params = new URL(request.url).searchParams
      const kind = kindSchema.safeParse(params.get('kind'))
      const id = params.get('id')
      if (!kind.success || !id) return Response.json({ error: t('api:invalidRequest') }, { status: 400 })
      if (kind.data !== 'topic' && !canManage(account)) {
        return Response.json({ error: t('library:libraryApi.deleteManagerOnly') }, { status: 403 })
      }

      const impact = await measure(account, kind.data, id)
      if (!impact) return Response.json({ error: t('library:libraryApi.itemGone') }, { status: 404 })

      // Database cascades take care of everything below; foreign keys are on.
      if (kind.data === 'subject') {
        await db.delete(subjects).where(and(inSchool(account, subjects), eq(subjects.id, id)))
      }
      if (kind.data === 'grade') {
        await db.delete(grades).where(and(inSchool(account, grades), eq(grades.id, id)))
      }
      if (kind.data === 'topic') {
        await db.delete(topics).where(and(inSchool(account, topics), eq(topics.id, id)))
      }

      await writeAudit({
        schoolId: account.schoolId,
        userId: account.userId,
        action: 'smazani-v-knihovne',
        entity: kind.data,
        entityId: id,
        detail: impact,
      })
      return Response.json({ ok: true, deleted: impact })
    },
    { write: true },
  )
}

/** Counts what lies under the given item, without deleting. */
async function measure(scope: Scope, kind: Kind, id: string): Promise<DeletionImpact | null> {
  let name = ''
  let topicIds: string[] = []
  let gradeCount = 0

  if (kind === 'subject') {
    const [row] = await db
      .select({ name: subjects.name })
      .from(subjects)
      .where(and(inSchool(scope, subjects), eq(subjects.id, id)))
      .limit(1)
    if (!row) return null
    name = row.name
    const gradeRows = await db
      .select({ id: grades.id })
      .from(grades)
      .where(and(inSchool(scope, grades), eq(grades.subjectId, id)))
    gradeCount = gradeRows.length
    topicIds = gradeRows.length
      ? (
          await db
            .select({ id: topics.id })
            .from(topics)
            .where(
              and(inSchool(scope, topics), inArray(topics.gradeId, gradeRows.map((grade) => grade.id))),
            )
        ).map((topic) => topic.id)
      : []
  } else if (kind === 'grade') {
    const [row] = await db
      .select({ name: grades.name, subject: subjects.name })
      .from(grades)
      .innerJoin(subjects, eq(subjects.id, grades.subjectId))
      .where(and(inSchool(scope, grades), eq(grades.id, id)))
      .limit(1)
    if (!row) return null
    name = `${row.subject} · ${row.name || t('library:labels.noGrade')}`
    topicIds = (
      await db
        .select({ id: topics.id })
        .from(topics)
        .where(and(inSchool(scope, topics), eq(topics.gradeId, id)))
    ).map((topic) => topic.id)
  } else {
    const [row] = await db
      .select({ name: topics.name })
      .from(topics)
      .where(and(inSchool(scope, topics), eq(topics.id, id)))
      .limit(1)
    if (!row) return null
    name = row.name
    topicIds = [id]
  }

  if (topicIds.length === 0) {
    return { name, grades: gradeCount, topics: 0, materials: 0, questions: 0, affectedTests: [] }
  }

  const [materialCount] = await db
    .select({ value: sql<number>`count(*)` })
    .from(materials)
    .where(and(inSchool(scope, materials), inArray(materials.topicId, topicIds)))

  const questionRows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(inSchool(scope, questions), isNotNull(questions.topicId), inArray(questions.topicId, topicIds)),
    )

  const affectedTests = questionRows.length
    ? (
        await db
          .selectDistinct({ title: tests.title })
          .from(testItems)
          .innerJoin(tests, eq(tests.id, testItems.testId))
          .where(
            and(
              inSchool(scope, testItems),
              inArray(testItems.questionId, questionRows.map((question) => question.id)),
            ),
          )
      ).map((test) => test.title)
    : []

  return {
    name,
    grades: gradeCount,
    topics: topicIds.length,
    materials: Number(materialCount?.value ?? 0),
    questions: questionRows.length,
    affectedTests,
  }
}
