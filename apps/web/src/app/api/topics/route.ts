import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db, grades, materials, questions, topics } from '@/db'
import { recomputeTopicContent } from '@/lib/duplicates'
import { newId } from '@/lib/ids'
import { inSchool, withScope, type Scope } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

const patchSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(200).optional(),
    /** Grade name; an empty string means "no grade". The grade is created if it doesn't exist yet. */
    gradeName: z.string().max(60).optional(),
  })
  .refine((value) => value.name !== undefined || value.gradeName !== undefined, {
    message: 'Nothing to change',
  })

const mergeSchema = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) })
const moveSchema = z.object({ materialId: z.string().min(1), topicId: z.string().min(1) })

/**
 * Options for managing a group.
 * `siblingsOf` returns the other topics of the same grade (for merging and moving a material),
 * `gradesOf` returns the grades of the same subject (for re-assigning the topic).
 */
export async function GET(request: Request) {
  return withScope(async (account) => {
  const params = new URL(request.url).searchParams
  const siblingsOf = params.get('siblingsOf')
  const gradesOf = params.get('gradesOf')
  const topicId = siblingsOf ?? gradesOf
  if (!topicId) return Response.json({ topics: [], grades: [] })

  const [current] = await db
    .select({ gradeId: topics.gradeId, subjectId: grades.subjectId, gradeName: grades.name })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .where(and(inSchool(account, topics), eq(topics.id, topicId)))
    .limit(1)
  if (!current) return Response.json({ topics: [], grades: [] })

  if (gradesOf) {
    const rows = await db
      .select({ id: grades.id, name: grades.name })
      .from(grades)
      .where(and(inSchool(account, grades), eq(grades.subjectId, current.subjectId)))
      .orderBy(asc(grades.position), asc(grades.name))
    return Response.json({ grades: rows, currentGrade: current.gradeName })
  }

  const rows = await db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(and(inSchool(account, topics), eq(topics.gradeId, current.gradeId), ne(topics.id, topicId)))
    .orderBy(asc(topics.name))

  return Response.json({ topics: rows })
  })
}

/** Renames a group, moves it to another grade, or both. */
export async function PATCH(request: Request) {
  return withScope(async (account) => {
  const parsed = patchSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: t('api:invalidRequest') }, { status: 400 })
  const { id, name, gradeName } = parsed.data

  const update: { name?: string; gradeId?: string } = {}
  if (name !== undefined) update.name = name.trim()

  if (gradeName !== undefined) {
    const [current] = await db
      .select({ subjectId: grades.subjectId })
      .from(topics)
      .innerJoin(grades, eq(grades.id, topics.gradeId))
      .where(and(inSchool(account, topics), eq(topics.id, id)))
      .limit(1)
    if (!current) return topicNotFound()
    update.gradeId = await ensureGrade(account, current.subjectId, gradeName.trim())
  }

  await db.update(topics).set(update).where(and(inSchool(account, topics), eq(topics.id, id)))
  return Response.json({ ok: true })
  }, { write: true })
}

/** Moves a material to another group. */
export async function PUT(request: Request) {
  return withScope(async (account) => {
  const parsed = moveSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: t('api:invalidRequest') }, { status: 400 })
  const { materialId, topicId } = parsed.data

  const [current] = await db
    .select({ topicId: materials.topicId, contentHash: materials.contentHash })
    .from(materials)
    .where(and(inSchool(account, materials), eq(materials.id, materialId)))
    .limit(1)
  if (!current) return Response.json({ error: t('library:topicsApi.materialGone') }, { status: 404 })
  if (!(await schoolTopic(account, topicId))) return topicNotFound()

  // The same content may be in a topic only once — otherwise the move would
  // fail on the unique index and the teacher would see only a server error.
  const [alreadyThere] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(
      and(
        inSchool(account, materials),
        eq(materials.topicId, topicId),
        eq(materials.contentHash, current.contentHash),
        ne(materials.id, materialId),
      ),
    )
    .limit(1)
  if (alreadyThere) {
    return Response.json(
      { error: t('library:topicsApi.sameFileInTarget') },
      { status: 409 },
    )
  }

  await db
    .update(materials)
    .set({ topicId, duplicateOfId: null, duplicateScore: null })
    .where(and(inSchool(account, materials), eq(materials.id, materialId)))

  // Materials that marked the moved one as their original would point outside
  // their topic after the move — generation would skip them forever because of it.
  // So the link is dropped; any new duplicate is detected by the next import.
  await db
    .update(materials)
    .set({ duplicateOfId: null, duplicateScore: null })
    .where(and(inSchool(account, materials), eq(materials.duplicateOfId, materialId)))

  // Questions follow their material, in every status including approved:
  // staying in the original topic would mean asking in a test about content
  // that is no longer there. Questions without a material link (missing
  // evidence, or the file name repeated in the topic) stay — moving them
  // blindly would carry other people's work out of the topic.
  await db
    .update(questions)
    .set({ topicId })
    .where(
      and(
        inSchool(account, questions),
        eq(questions.materialId, materialId),
        eq(questions.topicId, current.topicId),
      ),
    )

  for (const affected of new Set([current.topicId, topicId])) {
    await recomputeTopicContent(account, affected)
  }
  return Response.json({ ok: true })
  }, { write: true })
}

/** Merges a topic into another: moves materials and questions and deletes the original topic. */
export async function POST(request: Request) {
  return withScope(async (account) => {
  const parsed = mergeSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: t('api:invalidRequest') }, { status: 400 })
  const { sourceId, targetId } = parsed.data
  if (sourceId === targetId) {
    return Response.json({ error: t('library:topicsApi.mergeIntoSelf') }, { status: 400 })
  }
  if (!(await schoolTopic(account, sourceId)) || !(await schoolTopic(account, targetId))) return topicNotFound()

  // Content the target topic already has won't fit a second time (the same
  // content may be in a topic only once) — so it's dropped from the removed topic.
  const targetHashes = (
    await db
      .select({ hash: materials.contentHash })
      .from(materials)
      .where(and(inSchool(account, materials), eq(materials.topicId, targetId)))
  ).map((row) => row.hash)
  if (targetHashes.length > 0) {
    await db
      .delete(materials)
      .where(
        and(
          inSchool(account, materials),
          eq(materials.topicId, sourceId),
          inArray(materials.contentHash, targetHashes),
        ),
      )
  }

  await db
    .update(materials)
    .set({ topicId: targetId })
    .where(and(inSchool(account, materials), eq(materials.topicId, sourceId)))
  await db
    .update(questions)
    .set({ topicId: targetId })
    .where(and(inSchool(account, questions), eq(questions.topicId, sourceId)))
  await db.delete(topics).where(and(inSchool(account, topics), eq(topics.id, sourceId)))

  await recomputeTopicContent(account, targetId)

  return Response.json({ ok: true })
  }, { write: true })
}

const topicNotFound = () =>
  Response.json(
  { error: t('library:topicsApi.topicGone') },
  { status: 404 },
)

/** Is the topic in my school? A foreign move target looks non-existent. */
async function schoolTopic(scope: Scope, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(inSchool(scope, topics), eq(topics.id, id)))
    .limit(1)
  return Boolean(row)
}

/** Finds a grade with the given name in a subject, or creates it. */
async function ensureGrade(scope: Scope, subjectId: string, name: string): Promise<string> {
  const [existing] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(inSchool(scope, grades), eq(grades.subjectId, subjectId), eq(grades.name, name)))
    .limit(1)
  if (existing) return existing.id

  const id = newId()
  await db
    .insert(grades)
    .values({
      id,
      schoolId: scope.schoolId,
      createdBy: scope.userId,
      subjectId,
      name,
      position: gradePosition(name),
    })
    .onConflictDoNothing()
  const [created] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(inSchool(scope, grades), eq(grades.subjectId, subjectId), eq(grades.name, name)))
    .limit(1)
  return created?.id ?? id
}

/** Grades sort numerically; "no grade" goes first. */
function gradePosition(name: string): number {
  const match = /^(\d+)/.exec(name)
  return match ? Number(match[1]) : 0
}
