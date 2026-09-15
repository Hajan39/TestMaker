import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { testHeaderConfigSchema } from '@testmaker/core/schema'
import { db, templates, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'

export const runtime = 'nodejs'

const itemSchema = z.object({
  kind: z.enum(['question', 'heading', 'instruction', 'page_break']),
  questionId: z.string().nullable().default(null),
  text: z.string().nullable().default(null),
  pointsOverride: z.number().nullable().default(null),
  /** Počet linek na odpověď jen pro tenhle test; prázdné = podle otázky. */
  linesOverride: z.number().int().min(1).max(30).nullable().default(null),
})

const testSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().default(null),
  graded: z.boolean().default(true),
  templateId: z.string().min(1),
  header: testHeaderConfigSchema,
  variants: z.union([z.literal(1), z.literal(2)]).default(1),
  showKey: z.boolean().default(true),
  items: z.array(itemSchema).default([]),
})

export async function GET() {
  const rows = await db
    .select({
      id: tests.id,
      title: tests.title,
      graded: tests.graded,
      createdAt: tests.createdAt,
      updatedAt: tests.updatedAt,
      templateName: templates.name,
      itemCount: sql<number>`(select count(*) from ${testItems} where ${testItems.testId} = ${tests.id})`,
    })
    .from(tests)
    .innerJoin(templates, eq(templates.id, tests.templateId))
    .orderBy(desc(tests.updatedAt))
  return Response.json({ tests: rows })
}

/** Založí test i s položkami. */
export async function POST(request: Request) {
  const parsed = testSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }
  const id = newId()
  const { items, ...test } = parsed.data

  await db.insert(tests).values({ id, ...test })
  await writeItems(id, items)

  return Response.json({ id })
}

/** Přepíše test i celý seznam položek. */
export async function PUT(request: Request) {
  const schema = testSchema.extend({ id: z.string().min(1) })
  const parsed = schema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }
  const { id, items, ...test } = parsed.data

  await db
    .update(tests)
    .set({ ...test, updatedAt: new Date().toISOString() })
    .where(eq(tests.id, id))
  await db.delete(testItems).where(eq(testItems.testId, id))
  await writeItems(id, items)

  return Response.json({ id })
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Chybí id' }, { status: 400 })
  await db.delete(tests).where(eq(tests.id, id))
  return Response.json({ ok: true })
}

async function writeItems(testId: string, items: z.infer<typeof itemSchema>[]): Promise<void> {
  if (items.length === 0) return
  await db.insert(testItems).values(
    items.map((item, index) => ({
      id: newId(),
      testId,
      position: index,
      kind: item.kind,
      questionId: item.kind === 'question' ? item.questionId : null,
      text: item.kind === 'question' ? null : item.text,
      pointsOverride: item.pointsOverride,
      linesOverride: item.kind === 'question' ? item.linesOverride : null,
    })),
  )
}
