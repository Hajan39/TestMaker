import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, grades, topics } from '@/db'
import { skola, sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const schema = z.object({
  gradeId: z.string().min(1),
  /** Všechna témata ročníku v novém pořadí; `null` vrátí ročník k abecedě. */
  topicIds: z.array(z.string().min(1)).nullable(),
})

/**
 * Ruční pořadí témat v ročníku. Knihovna je společná pro školu, takže
 * přeskládání uvidí všichni — stejně jako přejmenování. Seznam musí obsahovat
 * právě všechna témata ročníku: kdyby se mezitím nějaké přidalo nebo
 * smazalo, pořadí by se uložilo jen napůl.
 */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const parsed = schema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
      const { gradeId, topicIds } = parsed.data

      const [grade] = await db
        .select({ id: grades.id })
        .from(grades)
        .where(and(skola(ucet, grades), eq(grades.id, gradeId)))
        .limit(1)
      if (!grade) return Response.json({ error: 'Nenalezeno' }, { status: 404 })

      const vRocniku = and(skola(ucet, topics), eq(topics.gradeId, gradeId))

      if (topicIds === null) {
        await db.update(topics).set({ position: 0 }).where(vRocniku)
        return Response.json({ ok: true })
      }

      const existujici = await db.select({ id: topics.id }).from(topics).where(vRocniku)
      const ocekavana = new Set(existujici.map((topic) => topic.id))
      const shoda =
        topicIds.length === ocekavana.size &&
        new Set(topicIds).size === topicIds.length &&
        topicIds.every((id) => ocekavana.has(id))
      if (!shoda) {
        return Response.json(
          { error: 'Témata ročníku se mezitím změnila. Obnovte stránku a zkuste to znovu.' },
          { status: 400 },
        )
      }

      // Jedním zápisem, ať se pořadí neuloží napůl.
      const [prvni, ...dalsi] = topicIds.map((id, index) =>
        db
          .update(topics)
          .set({ position: index + 1 })
          .where(and(vRocniku, eq(topics.id, id))),
      )
      if (prvni) await db.batch([prvni, ...dalsi])
      return Response.json({ ok: true })
    },
    { zapis: true },
  )
}
