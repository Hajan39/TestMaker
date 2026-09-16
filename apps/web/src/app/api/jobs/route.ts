import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { AI_QUESTION_TYPES } from '@testmaker/core/schema'
import { db, generationJobs, grades, materials, questions, topics } from '@/db'
import { newId } from '@/lib/ids'
import { DEFAULT_GENERATE_PARAMS } from '@/lib/generation'

export const runtime = 'nodejs'

const enqueueSchema = z.object({
  /** Rozsah zařazení — stačí jeden z údajů. */
  topicIds: z.array(z.string()).optional(),
  gradeId: z.string().optional(),
  subjectId: z.string().optional(),
  count: z.number().int().min(1).max(60).default(DEFAULT_GENERATE_PARAMS.count),
  types: z.array(z.enum(AI_QUESTION_TYPES)).min(1).default([...AI_QUESTION_TYPES]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('mix')]).default('mix'),
  /** Přeskočit témata, která už otázky mají. U doplňování nedává smysl. */
  skipWithQuestions: z.boolean().default(true),
  /** `add` = tolik nových otázek, `target` = doplnit každé téma na tenhle počet. */
  mode: z.enum(['add', 'target']).default('add'),
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

  const scope = await resolveTopicIds(input)
  if (scope.length === 0) return Response.json({ enqueued: 0, skipped: 0 })

  // Témata bez použitelného textu nemá smysl zařazovat.
  const withText = await db
    .selectDistinct({ id: materials.topicId })
    .from(materials)
    .where(and(inArray(materials.topicId, scope), isNull(materials.duplicateOfId)))
  const topicIds = withText.map((row) => row.id)

  // Témata, která už otázky mají nebo čekají ve frontě, znovu nezařazujeme.
  const busy = new Set<string>()
  // Doplňování se témat s otázkami týká ze všeho nejvíc, proto se u něj
  // nepřeskakují.
  if (input.skipWithQuestions && input.mode !== 'target') {
    const withQuestions = await db
      .selectDistinct({ id: questions.topicId })
      .from(questions)
      .where(and(isNotNull(questions.topicId), inArray(questions.topicId, topicIds)))
    for (const row of withQuestions) if (row.id) busy.add(row.id)
  }
  const pending = await db
    .select({ id: generationJobs.topicId })
    .from(generationJobs)
    .where(
      and(
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
        topicId,
        params: { count: input.count, types: input.types, difficulty: input.difficulty, mode: input.mode },
      })),
    )
  }

  return Response.json({ enqueued: toEnqueue.length, skipped: topicIds.length - toEnqueue.length })
}

/**
 * Vyprázdní frontu. Maže i běžící úlohy — po přerušeném běhu zůstávají viset
 * a bez toho by jejich témata šlo odblokovat jedině zásahem do databáze.
 */
export async function DELETE() {
  const removed = await db
    .delete(generationJobs)
    .where(inArray(generationJobs.status, ['queued', 'error', 'running']))
    .returning({ id: generationJobs.id })
  return Response.json({ ok: true, removed: removed.length })
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
