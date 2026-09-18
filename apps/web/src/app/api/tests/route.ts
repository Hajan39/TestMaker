import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { testHeaderConfigSchema } from '@testmaker/core/schema'
import { db, templates, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import { buildPuzzleSnapshots, buildQuestionSnapshots, testConditions } from '@/lib/tests'

export const runtime = 'nodejs'

const itemSchema = z.object({
  /**
   * Id už uložené položky, pokud jde o úpravu. Slouží k tomu, aby se při
   * přeuložení nezahodil zmrazený obsah otázky, která mezitím z banky zmizela
   * — tam už není z čeho snímek pořídit znovu.
   */
  id: z.string().nullable().default(null),
  kind: z.enum(['question', 'heading', 'instruction', 'page_break', 'puzzle']),
  questionId: z.string().nullable().default(null),
  /** Vyplněné u položky druhu `puzzle` — hlavolam zařazený do písemky. */
  puzzleId: z.string().nullable().default(null),
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

/**
 * Seznam testů. Volitelně zúžený hledáním v názvu a popisu (`q`) a šablonou
 * (`templateId`) — testů přibývá každý rok a projít je očima přestalo stačit.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const conditions = testConditions({
    search: params.get('q') ?? undefined,
    templateId: params.get('templateId') ?? undefined,
  })

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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tests.updatedAt))
  return Response.json({ tests: rows })
}

/**
 * Kopie hotového testu.
 *
 * Loňskou písemku chce učitelka použít znovu, ne přepsat — proto kopie, a ne
 * úprava originálu. Přebírají se i **zmrazené snímky otázek**: kdyby se
 * pořizovaly znovu z banky, dostala by kopie dnešní znění otázek místo toho,
 * co se tehdy tisklo, a k loňské písemce by už nešlo vyrobit stejný klíč.
 */
async function copyTest(sourceId: string): Promise<Response> {
  const [source] = await db.select().from(tests).where(eq(tests.id, sourceId)).limit(1)
  if (!source) return Response.json({ error: 'Test se nenašel' }, { status: 404 })

  const items = await db
    .select()
    .from(testItems)
    .where(eq(testItems.testId, sourceId))
    .orderBy(asc(testItems.position))

  const id = newId()
  const now = new Date().toISOString()
  await db.insert(tests).values({
    id,
    title: `${source.title} (kopie)`,
    description: source.description,
    graded: source.graded,
    templateId: source.templateId,
    header: source.header,
    variants: source.variants,
    showKey: source.showKey,
    createdAt: now,
    updatedAt: now,
  })

  if (items.length > 0) {
    await db.insert(testItems).values(
      items.map((item) => ({
        id: newId(),
        testId: id,
        position: item.position,
        kind: item.kind,
        questionId: item.questionId,
        text: item.text,
        pointsOverride: item.pointsOverride,
        linesOverride: item.linesOverride,
        // Snímek se přebírá tak, jak je — kopie musí vypadat jako originál,
        // i když se otázka v bance mezitím změnila nebo úplně zmizela.
        questionSnapshot: item.questionSnapshot,
        puzzleId: item.puzzleId,
        puzzleSnapshot: item.puzzleSnapshot,
      })),
    )
  }

  return Response.json({ id, copiedFrom: sourceId, items: items.length })
}

/** Založí test i s položkami; s `?copyOf=<id>` udělá kopii existujícího. */
export async function POST(request: Request) {
  const copyOf = new URL(request.url).searchParams.get('copyOf')
  // Kopie se pozná podle adresy a tělo požadavku nemá — čte se proto až tady,
  // po odbočce.
  if (copyOf) return copyTest(copyOf)

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
  // Snímky zmizelých otázek se musí načíst dřív, než se staré položky smažou.
  const existing = await db
    .select({
      id: testItems.id,
      questionSnapshot: testItems.questionSnapshot,
      puzzleSnapshot: testItems.puzzleSnapshot,
    })
    .from(testItems)
    .where(eq(testItems.testId, id))
  const keptSnapshots = new Map(
    existing.filter((row) => row.questionSnapshot).map((row) => [row.id, row.questionSnapshot as string]),
  )
  const keptPuzzleSnapshots = new Map(
    existing.filter((row) => row.puzzleSnapshot).map((row) => [row.id, row.puzzleSnapshot as string]),
  )

  await db.delete(testItems).where(eq(testItems.testId, id))
  await writeItems(id, items, keptSnapshots, keptPuzzleSnapshots)

  return Response.json({ id })
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Chybí id' }, { status: 400 })
  await db.delete(tests).where(eq(tests.id, id))
  return Response.json({ ok: true })
}

async function writeItems(
  testId: string,
  items: z.infer<typeof itemSchema>[],
  keptSnapshots: Map<string, string> = new Map(),
  keptPuzzleSnapshots: Map<string, string> = new Map(),
): Promise<void> {
  if (items.length === 0) return

  // Snímek se pořizuje tady na serveru z aktuálního obsahu banky. Klient ho
  // neposílá — jinak by šlo do hotové písemky podstrčit cokoli.
  const snapshots = await buildQuestionSnapshots(
    items
      .filter((item) => item.kind === 'question')
      .map((item) => item.questionId)
      .filter((id): id is string => Boolean(id)),
  )

  // Totéž pro hlavolam: co se zařadilo do písemky, drží snímek.
  const puzzleSnapshots = await buildPuzzleSnapshots(
    items
      .filter((item) => item.kind === 'puzzle')
      .map((item) => item.puzzleId)
      .filter((id): id is string => Boolean(id)),
  )

  await db.insert(testItems).values(
    items.map((item, index) => {
      const questionId = item.kind === 'question' ? item.questionId : null
      const puzzleId = item.kind === 'puzzle' ? item.puzzleId : null
      return {
        id: newId(),
        testId,
        position: index,
        kind: item.kind,
        questionId,
        text: item.kind === 'question' || item.kind === 'puzzle' ? null : item.text,
        pointsOverride: item.pointsOverride,
        linesOverride: item.kind === 'question' ? item.linesOverride : null,
        // Snímek se pořizuje jednou, při zařazení otázky do testu. U položky,
        // která v testu už byla, se drží ten původní — jinak by přeuložení
        // testu (třeba kvůli opravě názvu) přepsalo obsah už vytištěné
        // písemky aktuálním zněním otázky, čemuž má zmrazení bránit.
        questionSnapshot:
          (item.id ? keptSnapshots.get(item.id) : null) ??
          (questionId ? (snapshots.get(questionId) ?? null) : null),
        puzzleId,
        puzzleSnapshot:
          (item.id ? keptPuzzleSnapshots.get(item.id) : null) ??
          (puzzleId ? (puzzleSnapshots.get(puzzleId) ?? null) : null),
      }
    }),
  )
}
