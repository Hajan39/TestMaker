import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, grades, topics } from '@/db'
import { inSchool, withScope } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

const schema = z.object({
  gradeId: z.string().min(1),
  /** All of the grade's topics in the new order; `null` returns the grade to alphabetical order. */
  topicIds: z.array(z.string().min(1)).nullable(),
})

/**
 * Manual order of topics within a grade. The library is shared by the school,
 * so everyone sees the reordering — just like a rename. The list must contain
 * exactly all of the grade's topics: if one was added or deleted in the
 * meantime, the order would only be half saved.
 */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
      const parsed = schema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: t('api:invalidRequest') }, { status: 400 })
      const { gradeId, topicIds } = parsed.data

      const [grade] = await db
        .select({ id: grades.id })
        .from(grades)
        .where(and(inSchool(account, grades), eq(grades.id, gradeId)))
        .limit(1)
      if (!grade) return Response.json({ error: t('library:libraryApi.itemGone') }, { status: 404 })

      const inGrade = and(inSchool(account, topics), eq(topics.gradeId, gradeId))

      if (topicIds === null) {
        await db.update(topics).set({ position: 0 }).where(inGrade)
        return Response.json({ ok: true })
      }

      const existing = await db.select({ id: topics.id }).from(topics).where(inGrade)
      const expected = new Set(existing.map((topic) => topic.id))
      const matches =
        topicIds.length === expected.size &&
        new Set(topicIds).size === topicIds.length &&
        topicIds.every((id) => expected.has(id))
      if (!matches) {
        return Response.json({ error: t('library:libraryApi.topicsChanged') }, { status: 400 })
      }

      // In a single write, so the order is never half saved.
      const [first, ...rest] = topicIds.map((id, index) =>
        db
          .update(topics)
          .set({ position: index + 1 })
          .where(and(inGrade, eq(topics.id, id))),
      )
      if (first) await db.batch([first, ...rest])
      return Response.json({ ok: true })
    },
    { write: true },
  )
}
