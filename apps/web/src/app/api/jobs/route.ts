import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { AI_QUESTION_TYPES } from '@testmaker/core/schema'
import { db, generationJobs, grades, materials, questions, topics } from '@/db'
import { newId } from '@/lib/ids'
import { DEFAULT_GENERATE_PARAMS } from '@/lib/generation'
import { clearJobs, countJobs, loadJobs } from '@/lib/jobs'
import { skola, sRozsahem, type Scope } from '@/lib/uzivatel'

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

/**
 * Stav generování. Bez parametru jen počty podle stavu — ptá se na ně ukazatel
 * v liště, a to opakovaně, takže musí být co nejlevnější. S `?vypis=1` k tomu
 * přibude i výpis jednotlivých témat pro přehled generování.
 */
export async function GET(request: Request) {
  return sRozsahem(async (ucet) => {
    const detail = new URL(request.url).searchParams.get('vypis') === '1'
    const counts = await countJobs(ucet)
    if (!detail) return Response.json(counts)
    return Response.json({ ...counts, jobs: await loadJobs(ucet) })
  })
}

/** Zařadí materiály do fronty hromadného generování. */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
  const parsed = enqueueSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }
  const input = parsed.data

  const vybrana = await resolveTopicIds(ucet, input)
  if (vybrana.length === 0) return Response.json({ enqueued: 0, skipped: 0 })

  // Témata bez použitelného textu nemá smysl zařazovat — stejné pravidlo jako
  // jinde: duplicitní ani ručně vyřazený materiál se nepočítá.
  const withText = await db
    .selectDistinct({ id: materials.topicId })
    .from(materials)
    .where(
      and(
        skola(ucet, materials),
        inArray(materials.topicId, vybrana),
        isNull(materials.duplicateOfId),
        eq(materials.excluded, false),
      ),
    )
  const topicIds = withText.map((row) => row.id)

  // Témata, která už otázky mají nebo čekají ve frontě, znovu nezařazujeme.
  const busy = new Set<string>()
  // Doplňování se témat s otázkami týká ze všeho nejvíc, proto se u něj
  // nepřeskakují.
  if (input.skipWithQuestions && input.mode !== 'target') {
    const withQuestions = await db
      .selectDistinct({ id: questions.topicId })
      .from(questions)
      .where(
        and(skola(ucet, questions), isNotNull(questions.topicId), inArray(questions.topicId, topicIds)),
      )
    for (const row of withQuestions) if (row.id) busy.add(row.id)
  }
  const pending = await db
    .select({ id: generationJobs.topicId })
    .from(generationJobs)
    .where(
      and(
        skola(ucet, generationJobs),
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
        schoolId: ucet.schoolId,
        requestedBy: ucet.userId,
        topicId,
        params: { count: input.count, types: input.types, difficulty: input.difficulty, mode: input.mode },
      })),
    )
  }

  return Response.json({ enqueued: toEnqueue.length, skipped: topicIds.length - toEnqueue.length })
    },
    { zapis: true },
  )
}

/**
 * Vyprázdní frontu. Maže i běžící úlohy — po přerušeném běhu zůstávají viset
 * a bez toho by jejich témata šlo odblokovat jedině zásahem do databáze.
 * S `?rozsah=vse` zmizí i výpis hotových, když si ho chce učitelka uklidit.
 */
export async function DELETE(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const co = new URL(request.url).searchParams.get('rozsah') === 'vse' ? 'vse' : 'cekajici'
      const removed = await clearJobs(ucet, co)
      return Response.json({ ok: true, removed })
    },
    { zapis: true },
  )
}

async function resolveTopicIds(
  scope: Scope,
  input: z.infer<typeof enqueueSchema>,
): Promise<string[]> {
  // I výčet témat od prohlížeče se prožene školou: id se dá napsat jakékoli.
  if (input.topicIds?.length) {
    const rows = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(skola(scope, topics), inArray(topics.id, input.topicIds)))
    return rows.map((row) => row.id)
  }
  if (input.gradeId) {
    const rows = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(skola(scope, topics), eq(topics.gradeId, input.gradeId)))
    return rows.map((row) => row.id)
  }
  if (input.subjectId) {
    const rows = await db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(grades, eq(grades.id, topics.gradeId))
      .where(and(skola(scope, topics), eq(grades.subjectId, input.subjectId)))
    return rows.map((row) => row.id)
  }
  return []
}
