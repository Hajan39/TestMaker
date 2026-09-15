import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db, grades, materials, questions, topics } from '@/db'
import { recomputeTopicContent } from '@/lib/duplicates'
import { newId } from '@/lib/ids'

export const runtime = 'nodejs'

const patchSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(200).optional(),
    /** Název ročníku; prázdný řetězec znamená „bez ročníku“. Ročník vznikne, pokud ještě není. */
    gradeName: z.string().max(60).optional(),
  })
  .refine((value) => value.name !== undefined || value.gradeName !== undefined, {
    message: 'Není co měnit',
  })

const mergeSchema = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) })
const moveSchema = z.object({ materialId: z.string().min(1), topicId: z.string().min(1) })

/**
 * Nabídky pro správu skupiny.
 * `siblingsOf` vrátí ostatní témata téhož ročníku (pro sloučení a přesun materiálu),
 * `gradesOf` vrátí ročníky téhož předmětu (pro přeřazení tématu).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const siblingsOf = params.get('siblingsOf')
  const gradesOf = params.get('gradesOf')
  const topicId = siblingsOf ?? gradesOf
  if (!topicId) return Response.json({ topics: [], grades: [] })

  const [current] = await db
    .select({ gradeId: topics.gradeId, subjectId: grades.subjectId, gradeName: grades.name })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .where(eq(topics.id, topicId))
    .limit(1)
  if (!current) return Response.json({ topics: [], grades: [] })

  if (gradesOf) {
    const rows = await db
      .select({ id: grades.id, name: grades.name })
      .from(grades)
      .where(eq(grades.subjectId, current.subjectId))
      .orderBy(asc(grades.position), asc(grades.name))
    return Response.json({ grades: rows, currentGrade: current.gradeName })
  }

  const rows = await db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(and(eq(topics.gradeId, current.gradeId), ne(topics.id, topicId)))
    .orderBy(asc(topics.name))

  return Response.json({ topics: rows })
}

/** Přejmenuje skupinu, přeřadí ji do jiného ročníku, nebo obojí. */
export async function PATCH(request: Request) {
  const parsed = patchSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
  const { id, name, gradeName } = parsed.data

  const update: { name?: string; gradeId?: string } = {}
  if (name !== undefined) update.name = name.trim()

  if (gradeName !== undefined) {
    const [current] = await db
      .select({ subjectId: grades.subjectId })
      .from(topics)
      .innerJoin(grades, eq(grades.id, topics.gradeId))
      .where(eq(topics.id, id))
      .limit(1)
    if (!current) return Response.json({ error: 'Téma nenalezeno' }, { status: 404 })
    update.gradeId = await ensureGrade(current.subjectId, gradeName.trim())
  }

  await db.update(topics).set(update).where(eq(topics.id, id))
  return Response.json({ ok: true })
}

/** Přesune materiál do jiné skupiny. */
export async function PUT(request: Request) {
  const parsed = moveSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
  const { materialId, topicId } = parsed.data

  const [current] = await db
    .select({ topicId: materials.topicId, contentHash: materials.contentHash })
    .from(materials)
    .where(eq(materials.id, materialId))
    .limit(1)
  if (!current) return Response.json({ error: 'Materiál nenalezen' }, { status: 404 })

  // Tentýž obsah smí být v tématu jen jednou — jinak by přesun spadl na
  // unikátním indexu a učitelka by viděla jen chybu serveru.
  const [uzTam] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(
      and(eq(materials.topicId, topicId), eq(materials.contentHash, current.contentHash), ne(materials.id, materialId)),
    )
    .limit(1)
  if (uzTam) {
    return Response.json(
      { error: 'Tentýž soubor už v cílové skupině je, přesouvat ho tam nemá smysl.' },
      { status: 409 },
    )
  }

  await db
    .update(materials)
    .set({ topicId, duplicateOfId: null, duplicateScore: null })
    .where(eq(materials.id, materialId))

  // Materiály, které přesouvaný označovaly za svůj originál, by po přesunu
  // ukazovaly mimo své téma — generování by je kvůli tomu navždy vynechávalo.
  // Odkaz proto rušíme; případnou novou duplicitu pozná až další import.
  await db
    .update(materials)
    .set({ duplicateOfId: null, duplicateScore: null })
    .where(eq(materials.duplicateOfId, materialId))

  for (const affected of new Set([current.topicId, topicId])) await recomputeTopicContent(affected)
  return Response.json({ ok: true })
}

/** Sloučí téma do jiného: přesune materiály i otázky a původní téma smaže. */
export async function POST(request: Request) {
  const parsed = mergeSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
  const { sourceId, targetId } = parsed.data
  if (sourceId === targetId) return Response.json({ error: 'Stejné téma' }, { status: 400 })

  // Obsah, který cílové téma už má, se do něj podruhé nevejde (tentýž obsah
  // smí být v tématu jen jednou) — z rušeného tématu ho proto zahodíme.
  const targetHashes = (
    await db.select({ hash: materials.contentHash }).from(materials).where(eq(materials.topicId, targetId))
  ).map((row) => row.hash)
  if (targetHashes.length > 0) {
    await db
      .delete(materials)
      .where(and(eq(materials.topicId, sourceId), inArray(materials.contentHash, targetHashes)))
  }

  await db.update(materials).set({ topicId: targetId }).where(eq(materials.topicId, sourceId))
  await db.update(questions).set({ topicId: targetId }).where(eq(questions.topicId, sourceId))
  await db.delete(topics).where(eq(topics.id, sourceId))

  await recomputeTopicContent(targetId)

  return Response.json({ ok: true })
}

/** Najde ročník daného jména v předmětu, nebo ho založí. */
async function ensureGrade(subjectId: string, name: string): Promise<string> {
  const [existing] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.subjectId, subjectId), eq(grades.name, name)))
    .limit(1)
  if (existing) return existing.id

  const id = newId()
  await db.insert(grades).values({ id, subjectId, name, position: gradePosition(name) }).onConflictDoNothing()
  const [created] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.subjectId, subjectId), eq(grades.name, name)))
    .limit(1)
  return created?.id ?? id
}

/** Ročník řadíme číselně, „bez ročníku“ jde první. */
function gradePosition(name: string): number {
  const match = /^(\d+)/.exec(name)
  return match ? Number(match[1]) : 0
}
