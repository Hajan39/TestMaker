import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, grades, materials, questions, subjects, testItems, tests, topics } from '@/db'
import { createLibraryItem, renameLibraryItem } from '@/lib/library'
import { ROLE_SPRAVY } from '@/lib/role'
import { sRozsahem, skola, zapsatAudit, type Scope } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const kindSchema = z.enum(['subject', 'grade', 'topic'])
type Kind = z.infer<typeof kindSchema>

/** Co všechno zmizí spolu s vybranou položkou. */
export interface DeletionImpact {
  name: string
  grades: number
  topics: number
  materials: number
  questions: number
  /** Názvy uložených testů, ze kterých otázky vypadnou. */
  affectedTests: string[]
}

/**
 * Náhled dopadu smazání. Mazání v knihovně je kaskádové — s předmětem zmizí
 * ročníky, témata, materiály i otázky — takže učitelka musí předem vidět,
 * o co přijde.
 */
export async function GET(request: Request) {
  return sRozsahem(async (ucet) => {
    const params = new URL(request.url).searchParams
    const kind = kindSchema.safeParse(params.get('kind'))
    const id = params.get('id')
    if (!kind.success || !id) return Response.json({ error: 'Neplatný dotaz' }, { status: 400 })

    const impact = await measure(ucet, kind.data, id)
    if (!impact) return Response.json({ error: 'Nenalezeno' }, { status: 404 })
    return Response.json(impact)
  })
}

const createSchema = z.object({
  kind: kindSchema,
  name: z.string().max(200),
  /** Předmět u ročníku, ročník u tématu. U předmětu se nevyplňuje. */
  parentId: z.string().min(1).nullish(),
})

const renameSchema = z.object({
  kind: kindSchema,
  id: z.string().min(1),
  name: z.string().max(200),
})

/**
 * Založí předmět, ročník nebo téma ručně — bez importu materiálů.
 * Učitelka si tak může připravit prázdné téma a napsat si do něj vlastní otázky.
 */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const parsed = createSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })

      const result = await createLibraryItem(ucet, parsed.data)
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
      return Response.json({ ok: true, id: result.id })
    },
    { zapis: true },
  )
}

/** Přejmenuje předmět, ročník nebo téma. */
export async function PATCH(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const parsed = renameSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })

      const result = await renameLibraryItem(ucet, parsed.data)
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
      return Response.json({ ok: true, id: result.id })
    },
    { zapis: true },
  )
}

/**
 * Smaže předmět, ročník nebo téma i se vším, co pod ním leží.
 *
 * Knihovna je společná, takže tohle mazání sahá na práci kolegyň — proto ho
 * smí jedině správce a proto se zapisuje do záznamu událostí.
 */
export async function DELETE(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const params = new URL(request.url).searchParams
      const kind = kindSchema.safeParse(params.get('kind'))
      const id = params.get('id')
      if (!kind.success || !id) return Response.json({ error: 'Neplatný dotaz' }, { status: 400 })

      const impact = await measure(ucet, kind.data, id)
      if (!impact) return Response.json({ error: 'Nenalezeno' }, { status: 404 })

      // Kaskády v databázi se postarají o vše níž; cizí klíče jsou zapnuté.
      if (kind.data === 'subject') {
        await db.delete(subjects).where(and(skola(ucet, subjects), eq(subjects.id, id)))
      }
      if (kind.data === 'grade') {
        await db.delete(grades).where(and(skola(ucet, grades), eq(grades.id, id)))
      }
      if (kind.data === 'topic') {
        await db.delete(topics).where(and(skola(ucet, topics), eq(topics.id, id)))
      }

      await zapsatAudit({
        schoolId: ucet.schoolId,
        userId: ucet.userId,
        action: 'smazani-v-knihovne',
        entity: kind.data,
        entityId: id,
        detail: impact,
      })
      return Response.json({ ok: true, deleted: impact })
    },
    { role: ROLE_SPRAVY },
  )
}

/** Spočítá, co pod danou položkou leží, bez mazání. */
async function measure(scope: Scope, kind: Kind, id: string): Promise<DeletionImpact | null> {
  let name = ''
  let topicIds: string[] = []
  let gradeCount = 0

  if (kind === 'subject') {
    const [row] = await db
      .select({ name: subjects.name })
      .from(subjects)
      .where(and(skola(scope, subjects), eq(subjects.id, id)))
      .limit(1)
    if (!row) return null
    name = row.name
    const gradeRows = await db
      .select({ id: grades.id })
      .from(grades)
      .where(and(skola(scope, grades), eq(grades.subjectId, id)))
    gradeCount = gradeRows.length
    topicIds = gradeRows.length
      ? (
          await db
            .select({ id: topics.id })
            .from(topics)
            .where(
              and(skola(scope, topics), inArray(topics.gradeId, gradeRows.map((grade) => grade.id))),
            )
        ).map((topic) => topic.id)
      : []
  } else if (kind === 'grade') {
    const [row] = await db
      .select({ name: grades.name, subject: subjects.name })
      .from(grades)
      .innerJoin(subjects, eq(subjects.id, grades.subjectId))
      .where(and(skola(scope, grades), eq(grades.id, id)))
      .limit(1)
    if (!row) return null
    name = `${row.subject} · ${row.name || 'Bez ročníku'}`
    topicIds = (
      await db
        .select({ id: topics.id })
        .from(topics)
        .where(and(skola(scope, topics), eq(topics.gradeId, id)))
    ).map((topic) => topic.id)
  } else {
    const [row] = await db
      .select({ name: topics.name })
      .from(topics)
      .where(and(skola(scope, topics), eq(topics.id, id)))
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
    .where(and(skola(scope, materials), inArray(materials.topicId, topicIds)))

  const questionRows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(skola(scope, questions), isNotNull(questions.topicId), inArray(questions.topicId, topicIds)),
    )

  const affectedTests = questionRows.length
    ? (
        await db
          .selectDistinct({ title: tests.title })
          .from(testItems)
          .innerJoin(tests, eq(tests.id, testItems.testId))
          .where(
            and(
              skola(scope, testItems),
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
