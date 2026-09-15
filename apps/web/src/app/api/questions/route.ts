import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { questionContentSchema, validateQuestionContent } from '@testmaker/core/schema'
import { db, questions } from '@/db'
import { deleteQuestionsWithAssets, insertQuestions } from '@/lib/questions'

export const runtime = 'nodejs'

const createSchema = z.object({
  topicId: z.string().min(1),
  question: questionContentSchema,
})

const updateSchema = z.object({
  id: z.string().min(1),
  question: questionContentSchema.optional(),
  status: z.enum(['draft', 'approved', 'rejected']).optional(),
})

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  status: z.enum(['draft', 'approved', 'rejected']),
})

/** Vlastní otázka učitele. */
export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }
  const problems = validateQuestionContent(parsed.data.question)
  if (problems.length > 0) return Response.json({ error: problems.join('; ') }, { status: 400 })

  const [id] = await insertQuestions([parsed.data.question], {
    topicId: parsed.data.topicId,
    source: 'manual',
    status: 'approved',
  })
  return Response.json({ id })
}

/** Úprava obsahu nebo stavu jedné otázky. */
export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (parsed.data.status) update.status = parsed.data.status
  if (parsed.data.question) {
    const problems = validateQuestionContent(parsed.data.question)
    if (problems.length > 0) return Response.json({ error: problems.join('; ') }, { status: 400 })
    update.type = parsed.data.question.type
    update.payload = parsed.data.question.payload
    update.blocks = parsed.data.question.blocks
    update.points = parsed.data.question.points
    update.difficulty = parsed.data.question.difficulty
    update.explanation = parsed.data.question.explanation ?? null
  }

  await db.update(questions).set(update).where(inArray(questions.id, [parsed.data.id]))
  return Response.json({ ok: true })
}

/** Hromadné schválení nebo zamítnutí. */
export async function PUT(request: Request) {
  const parsed = bulkSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }
  await db.update(questions).set({ status: parsed.data.status }).where(inArray(questions.id, parsed.data.ids))
  return Response.json({ updated: parsed.data.ids.length })
}

export async function DELETE(request: Request) {
  const ids = new URL(request.url).searchParams.getAll('id')
  if (ids.length === 0) return Response.json({ error: 'Chybí id' }, { status: 400 })
  await deleteQuestionsWithAssets(ids)
  return Response.json({ deleted: ids.length })
}
