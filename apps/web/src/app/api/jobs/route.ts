import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { AI_QUESTION_TYPES } from '@testmaker/core/schema'
import { db, generationJobs, grades, materials, questions, topics } from '@/db'
import { newId } from '@/lib/ids'
import { DEFAULT_GENERATE_PARAMS } from '@/lib/generation'
import { clearJobs, countJobs, loadJobs } from '@/lib/jobs'
import { inSchool, withScope, type Scope } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

const enqueueSchema = z.object({
  /** Enqueue range — one of the fields is enough. */
  topicIds: z.array(z.string()).optional(),
  gradeId: z.string().optional(),
  subjectId: z.string().optional(),
  count: z.number().int().min(1).max(60).default(DEFAULT_GENERATE_PARAMS.count),
  types: z.array(z.enum(AI_QUESTION_TYPES)).min(1).default([...AI_QUESTION_TYPES]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('mix')]).default('mix'),
  /** Skip topics that already have questions. Makes no sense when topping up. */
  skipWithQuestions: z.boolean().default(true),
  /** `add` = this many new questions, `target` = top each topic up to this count. */
  mode: z.enum(['add', 'target']).default('add'),
})

/**
 * Generation status. Without a parameter only counts per state — the toolbar
 * indicator asks for them repeatedly, so it must be as cheap as possible. With
 * `?vypis=1` the list of individual topics for the generation overview is added.
 */
export async function GET(request: Request) {
  return withScope(async (account) => {
    const detail = new URL(request.url).searchParams.get('vypis') === '1'
    const counts = await countJobs(account)
    if (!detail) return Response.json(counts)
    return Response.json({ ...counts, jobs: await loadJobs(account) })
  })
}

/** Enqueues materials for bulk generation. */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
  const parsed = enqueueSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
  }
  const input = parsed.data

  const selected = await resolveTopicIds(account, input)
  if (selected.length === 0) return Response.json({ enqueued: 0, skipped: 0 })

  // Topics without usable text make no sense to enqueue — the same rule as
  // elsewhere: neither a duplicate nor a manually excluded material counts.
  const withText = await db
    .selectDistinct({ id: materials.topicId })
    .from(materials)
    .where(
      and(
        inSchool(account, materials),
        inArray(materials.topicId, selected),
        isNull(materials.duplicateOfId),
        eq(materials.excluded, false),
      ),
    )
  const topicIds = withText.map((row) => row.id)

  // Topics that already have questions or wait in the queue aren't enqueued again.
  const busy = new Set<string>()
  // Topping up concerns topics with questions most of all, so they aren't
  // skipped then.
  if (input.skipWithQuestions && input.mode !== 'target') {
    const withQuestions = await db
      .selectDistinct({ id: questions.topicId })
      .from(questions)
      .where(
        and(inSchool(account, questions), isNotNull(questions.topicId), inArray(questions.topicId, topicIds)),
      )
    for (const row of withQuestions) if (row.id) busy.add(row.id)
  }
  const pending = await db
    .select({ id: generationJobs.topicId })
    .from(generationJobs)
    .where(
      and(
        inSchool(account, generationJobs),
        inArray(generationJobs.topicId, topicIds),
        inArray(generationJobs.status, ['queued', 'running']),
      ),
    )
  for (const row of pending) busy.add(row.id)

  const toEnqueue = topicIds.filter((id) => !busy.has(id))
  if (toEnqueue.length > 0) {
    await db.insert(generationJobs).values(
      toEnqueue.map((topicId) => ({
        id: newId(),
        schoolId: account.schoolId,
        requestedBy: account.userId,
        topicId,
        params: { count: input.count, types: input.types, difficulty: input.difficulty, mode: input.mode },
      })),
    )
  }

  return Response.json({ enqueued: toEnqueue.length, skipped: topicIds.length - toEnqueue.length })
    },
    { write: true },
  )
}

/**
 * Empties the queue. Deletes running jobs too — after an interrupted run they
 * stay hanging and their topics could otherwise only be unblocked in the database.
 * With `?rozsah=vse` the list of finished jobs goes too, when the teacher wants it cleaned up.
 */
export async function DELETE(request: Request) {
  return withScope(
    async (account) => {
      const mode = new URL(request.url).searchParams.get('rozsah') === 'vse' ? 'vse' : 'cekajici'
      const removed = await clearJobs(account, mode)
      return Response.json({ ok: true, removed })
    },
    { write: true },
  )
}

async function resolveTopicIds(
  scope: Scope,
  input: z.infer<typeof enqueueSchema>,
): Promise<string[]> {
  // Even a topic list from the browser is filtered by school: any id can be typed.
  if (input.topicIds?.length) {
    const rows = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(inSchool(scope, topics), inArray(topics.id, input.topicIds)))
    return rows.map((row) => row.id)
  }
  if (input.gradeId) {
    const rows = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(inSchool(scope, topics), eq(topics.gradeId, input.gradeId)))
    return rows.map((row) => row.id)
  }
  if (input.subjectId) {
    const rows = await db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(grades, eq(grades.id, topics.gradeId))
      .where(and(inSchool(scope, topics), eq(grades.subjectId, input.subjectId)))
    return rows.map((row) => row.id)
  }
  return []
}
