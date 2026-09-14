import { and, count, eq, inArray, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { AI_QUESTION_TYPES } from '@testmaker/core/schema'
import { db, generationJobs, grades, materials, questions, topics } from '@/db'
import { newId } from '@/lib/ids'
import { DEFAULT_GENERATE_PARAMS } from '@/lib/generation'

export const runtime = 'nodejs'

const enqueueSchema = z.object({
  /** Zařadit materiály podle rozsahu — jeden z nich. */
  materialIds: z.array(z.string()).optional(),
  topicIds: z.array(z.string()).optional(),
  gradeId: z.string().optional(),
  subjectId: z.string().optional(),
  count: z.number().int().min(1).max(60).default(DEFAULT_GENERATE_PARAMS.count),
  types: z.array(z.enum(AI_QUESTION_TYPES)).min(1).default([...AI_QUESTION_TYPES]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('mix')]).default('mix'),
  /** Přeskočit materiály, které už mají otázky. */
  skipWithQuestions: z.boolean().default(true),
})

/** Stav fronty. */
export async function GET() {
  const rows = await db
    .select({ status: generationJobs.status, value: count() })
    .from(generationJobs)
    .groupBy(generationJobs.status)

  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.value]))
  return Response.json({
    queued: byStatus.queued ?? 0,
    running: byStatus.running ?? 0,
    done: byStatus.done ?? 0,
    error: byStatus.error ?? 0,
  })
}

/** Zařadí materiály do fronty hromadného generování. */
export async function POST(request: Request) {
  const parsed = enqueueSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }
  const input = parsed.data

  let materialIds = input.materialIds ?? []
  if (materialIds.length === 0) {
    const topicIds = await resolveTopicIds(input)
    if (topicIds.length === 0) return Response.json({ enqueued: 0, skipped: 0 })
    const rows = await db
      .select({ id: materials.id })
      .from(materials)
      .where(inArray(materials.topicId, topicIds))
    materialIds = rows.map((row) => row.id)
  }

  if (materialIds.length === 0) return Response.json({ enqueued: 0, skipped: 0 })

  // Materiály, které už mají otázky nebo čekají ve frontě, znovu nezařazujeme.
  const busy = new Set<string>()
  if (input.skipWithQuestions) {
    const withQuestions = await db
      .selectDistinct({ id: questions.materialId })
      .from(questions)
      .where(and(isNotNull(questions.materialId), inArray(questions.materialId, materialIds)))
    for (const row of withQuestions) if (row.id) busy.add(row.id)
  }
  const pending = await db
    .select({ id: generationJobs.materialId })
    .from(generationJobs)
    .where(
      and(
        inArray(generationJobs.materialId, materialIds),
        inArray(generationJobs.status, ['queued', 'running']),
      ),
    )
  for (const row of pending) busy.add(row.id)

  const toEnqueue = materialIds.filter((id) => !busy.has(id))
  if (toEnqueue.length > 0) {
    await db.insert(generationJobs).values(
      toEnqueue.map((materialId) => ({
        id: newId(),
        materialId,
        params: { count: input.count, types: input.types, difficulty: input.difficulty },
      })),
    )
  }

  return Response.json({ enqueued: toEnqueue.length, skipped: materialIds.length - toEnqueue.length })
}

/** Vyprázdní frontu (čekající úlohy). */
export async function DELETE() {
  await db.delete(generationJobs).where(inArray(generationJobs.status, ['queued', 'error']))
  return Response.json({ ok: true })
}

async function resolveTopicIds(input: z.infer<typeof enqueueSchema>): Promise<string[]> {
  if (input.topicIds?.length) return input.topicIds
  if (input.gradeId) {
    const rows = await db.select({ id: topics.id }).from(topics).where(eq(topics.gradeId, input.gradeId))
    return rows.map((row) => row.id)
  }
  if (input.subjectId) {
    const rows = await db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(grades, eq(grades.id, topics.gradeId))
      .where(eq(grades.subjectId, input.subjectId))
    return rows.map((row) => row.id)
  }
  return []
}
