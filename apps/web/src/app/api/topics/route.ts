import { and, asc, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db, materials, questions, topics } from '@/db'

export const runtime = 'nodejs'

const renameSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(200) })
const mergeSchema = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) })
const moveSchema = z.object({ materialId: z.string().min(1), topicId: z.string().min(1) })

/** Témata téhož ročníku — nabídka pro sloučení a přesun materiálu. */
export async function GET(request: Request) {
  const topicId = new URL(request.url).searchParams.get('siblingsOf')
  if (!topicId) return Response.json({ topics: [] })

  const [current] = await db.select({ gradeId: topics.gradeId }).from(topics).where(eq(topics.id, topicId)).limit(1)
  if (!current) return Response.json({ topics: [] })

  const rows = await db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(and(eq(topics.gradeId, current.gradeId), ne(topics.id, topicId)))
    .orderBy(asc(topics.name))

  return Response.json({ topics: rows })
}

export async function PATCH(request: Request) {
  const parsed = renameSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
  await db.update(topics).set({ name: parsed.data.name.trim() }).where(eq(topics.id, parsed.data.id))
  return Response.json({ ok: true })
}

/** Přesune materiál do jiné skupiny. */
export async function PUT(request: Request) {
  const parsed = moveSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
  await db
    .update(materials)
    .set({ topicId: parsed.data.topicId, duplicateOfId: null, duplicateScore: null })
    .where(eq(materials.id, parsed.data.materialId))
  return Response.json({ ok: true })
}

/** Sloučí téma do jiného: přesune materiály i otázky a původní téma smaže. */
export async function POST(request: Request) {
  const parsed = mergeSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
  const { sourceId, targetId } = parsed.data
  if (sourceId === targetId) return Response.json({ error: 'Stejné téma' }, { status: 400 })

  await db.update(materials).set({ topicId: targetId }).where(eq(materials.topicId, sourceId))
  await db.update(questions).set({ topicId: targetId }).where(eq(questions.topicId, sourceId))
  await db.delete(topics).where(eq(topics.id, sourceId))

  return Response.json({ ok: true })
}
