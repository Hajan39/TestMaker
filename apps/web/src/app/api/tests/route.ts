import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  parseItemContent,
  questionContentSchema,
  serializeQuestionSnapshot,
  TEST_ITEM_KINDS,
  testHeaderConfigSchema,
  testKindSchema,
  type TestKind,
} from '@testmaker/core/schema'
import { db, templates, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import {
  buildPuzzleSnapshots,
  buildQuestionSnapshots,
  copyTest,
  resolveGradeId,
  resolveTopic,
  testConditions,
} from '@/lib/tests'
import { skola, sRozsahem, vlastni, type Prihlaseny } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const itemSchema = z.object({
  /**
   * Id už uložené položky, pokud jde o úpravu. Slouží k tomu, aby se při
   * přeuložení nezahodil zmrazený obsah otázky, která mezitím z banky zmizela
   * — tam už není z čeho snímek pořídit znovu.
   */
  id: z.string().nullable().default(null),
  kind: z.enum(TEST_ITEM_KINDS),
  questionId: z.string().nullable().default(null),
  /** Vyplněné u položky druhu `puzzle` — hlavolam zařazený do písemky. */
  puzzleId: z.string().nullable().default(null),
  text: z.string().nullable().default(null),
  pointsOverride: z.number().nullable().default(null),
  /** Počet linek na odpověď jen pro tenhle test; prázdné = podle otázky. */
  linesOverride: z.number().int().min(1).max(30).nullable().default(null),
  /** Obsah položky `text` (varianta) nebo `table` (mřížka); ověřuje se schématem z core. */
  content: z.unknown().optional(),
  /** Značka „ověř“ u položky listu. */
  needsCheck: z.boolean().default(false),
  /**
   * Obsah úlohy pracovního listu. Úloha listu v bance není, takže její snímek
   * posílá klient; u písemky se pole ignoruje a snímek vzniká z banky.
   */
  question: questionContentSchema.nullable().default(null),
})

const testSchema = z.object({
  title: z.string().min(1).max(200),
  /** Sdílení s kolegyněmi; výchozí je soukromá písemka. */
  visibility: z.enum(['soukrome', 'skola']).default('soukrome'),
  description: z.string().max(1000).nullable().default(null),
  graded: z.boolean().default(true),
  templateId: z.string().min(1),
  /** Třída, ze které test vznikl; ověřuje se proti škole při uložení. */
  gradeId: z.string().min(1).nullable().default(null),
  header: testHeaderConfigSchema,
  variants: z.union([z.literal(1), z.literal(2)]).default(1),
  showKey: z.boolean().default(true),
  items: z.array(itemSchema).default([]),
  /** Písemka, nebo pracovní list. Mění se jen při založení. */
  kind: testKindSchema.default('pisemka'),
  /** Téma listu; ověřuje se proti škole. Mění se jen při založení. */
  topicId: z.string().min(1).nullable().default(null),
  /** Zadání listu (JSON podle `worksheetBriefSchema`). Mění se jen při založení. */
  brief: z.string().max(40_000).nullable().default(null),
})

type Item = z.infer<typeof itemSchema>

/**
 * Odmítnuté tělo požadavku. Editor hlídá název i položky sám, takže sem se
 * dostane spíš zastaralá stránka nebo chybějící šablona než překlep.
 */
const NEPLATNY_TEST =
  'Písemku se nepodařilo uložit — chybí název (nejvýš 200 znaků) nebo šablona, případně je některá položka neúplná. ' +
  'Zkontroluj to, obnov stránku a zkus to znovu.'

/**
 * Obsah položek zkontrolovaný dřív, než se cokoli zapíše — odmítnutý list
 * nesmí zůstat v databázi napůl uložený.
 */
function checkItems(kind: TestKind, items: Item[]): Response | null {
  for (const item of items) {
    if (item.kind === 'text' && !parseItemContent('text', item.content)) {
      return Response.json({ error: 'Text v listu nemá platnou variantu (text, nebo fun fact).' }, { status: 400 })
    }
    if (item.kind === 'table' && !parseItemContent('table', item.content)) {
      return Response.json(
        {
          error:
            'Tabulku nejde uložit: každý řádek musí mít tolik buněk, kolik je sloupců (nejvýš 6 sloupců a 12 řádků), ' +
            'a aspoň jedna buňka musí zůstat prázdná k doplnění.',
        },
        { status: 400 },
      )
    }
    if (kind === 'pracovni_list' && item.kind === 'question' && !item.questionId && !item.question) {
      return Response.json({ error: 'Úloha v listu nemá žádné zadání. Doplň ji, nebo ji odeber.' }, { status: 400 })
    }
  }
  return null
}

/**
 * Seznam testů. Volitelně zúžený hledáním v názvu a popisu (`q`), šablonou
 * (`templateId`) a třídou (`gradeId`) — testů přibývá každý rok a projít je
 * očima přestalo stačit.
 */
export async function GET(request: Request) {
  return sRozsahem(async (ucet) => {
  const params = new URL(request.url).searchParams
  const conditions = testConditions(ucet, {
    search: params.get('q') ?? undefined,
    templateId: params.get('templateId') ?? undefined,
    gradeId: params.get('gradeId') ?? undefined,
  })

  const rows = await db
    .select({
      id: tests.id,
      title: tests.title,
      graded: tests.graded,
      createdAt: tests.createdAt,
      updatedAt: tests.updatedAt,
      templateName: templates.name,
      /** Vlastní, nebo nasdílená kolegyní — v seznamu to musí být poznat. */
      mine: sql<boolean>`${tests.ownerId} = ${ucet.userId}`,
      visibility: tests.visibility,
      itemCount: sql<number>`(select count(*) from ${testItems} where ${testItems.testId} = ${tests.id})`,
    })
    .from(tests)
    .innerJoin(templates, eq(templates.id, tests.templateId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tests.updatedAt))
  return Response.json({ tests: rows })
  })
}

/** Odpověď na `?copyOf=`: kopie testu z `lib/tests.ts`, nebo 404, když zdroj není vidět. */
async function copyTestResponse(ucet: Prihlaseny, sourceId: string): Promise<Response> {
  const result = await copyTest(ucet, sourceId)
  if (!result) return Response.json({ error: 'Test se nenašel' }, { status: 404 })
  return Response.json({ id: result.id, copiedFrom: result.copiedFrom, items: result.items.length })
}

/** Založí test i s položkami; s `?copyOf=<id>` udělá kopii existujícího. */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const copyOf = new URL(request.url).searchParams.get('copyOf')
      // Kopie se pozná podle adresy a tělo požadavku nemá — čte se proto až
      // tady, po odbočce.
      if (copyOf) return copyTestResponse(ucet, copyOf)

      const parsed = testSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json({ error: NEPLATNY_TEST, detail: parsed.error.issues }, { status: 400 })
      }
      const id = newId()
      const { items, kind, topicId: topicVstup, brief, ...test } = parsed.data
      const invalid = checkItems(kind, items)
      if (invalid) return invalid

      const worksheet = kind === 'pracovni_list'
      // Téma a zadání patří jen listu; ročník listu k tématu se bere z tématu.
      const topic = worksheet ? await resolveTopic(ucet, topicVstup) : null
      const gradeId = (await resolveGradeId(ucet, test.gradeId)) ?? topic?.gradeId ?? null

      const rows = await itemRows(ucet, id, kind, items)
      if (rows instanceof Response) return rows

      // Test a položky jedním dávkovým zápisem — jinak by po chybě vložení
      // zůstal v přehledu prázdný test.
      await db.batch([
        db.insert(tests).values({
          id,
          schoolId: ucet.schoolId,
          ownerId: ucet.userId,
          ...test,
          kind,
          topicId: topic?.id ?? null,
          brief: worksheet ? brief : null,
          // Na listu se nic neznámkuje — bez ohledu na to, co pošle klient.
          graded: worksheet ? false : test.graded,
          gradeId,
        }),
        ...(rows.length > 0 ? [db.insert(testItems).values(rows)] : []),
      ])

      return Response.json({ id })
    },
    { zapis: true },
  )
}

/** Přepíše test i celý seznam položek. */
export async function PUT(request: Request) {
  return sRozsahem(
    async (ucet) => {
  // `gradeId` u PUT nemá výchozí hodnotu jako u POST: chybějící pole znamená
  // „nech třídu, jak je" (starší klient, co pole vůbec neposílá), zatímco
  // výslovné `null` znamená „zruš vazbu na třídu". Kdyby default doplnil
  // `null` i za chybějící pole, první uložení z editoru, který gradeId
  // neposílá, by třídu testu potichu smazalo.
  // Druh, téma a zadání se při úpravě nemění — editor je neposílá a výchozí
  // hodnoty schématu by je jinak potichu smazaly.
  const schema = testSchema.omit({ kind: true, topicId: true, brief: true }).extend({
    id: z.string().min(1),
    gradeId: z.string().min(1).nullable().optional(),
  })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: NEPLATNY_TEST, detail: parsed.error.issues }, { status: 400 })
  }
  const { id, items, gradeId: gradeIdVstup, ...test } = parsed.data
  const gradeId = gradeIdVstup === undefined ? undefined : await resolveGradeId(ucet, gradeIdVstup)

  // Upravovat smí jen vlastník: nasdílená písemka se dá přečíst a vytisknout,
  // ne přepsat.
  const [puvodni] = await db
    .select({ kind: tests.kind })
    .from(tests)
    .where(and(eq(tests.id, id), vlastni(ucet, tests)))
    .limit(1)
  if (!puvodni) return Response.json({ error: 'Test se nenašel' }, { status: 404 })
  const invalid = checkItems(puvodni.kind, items)
  if (invalid) return invalid

  // Snímky zmizelých otázek se musí načíst dřív, než se staré položky smažou.
  const existing = await db
    .select({
      id: testItems.id,
      questionSnapshot: testItems.questionSnapshot,
      puzzleSnapshot: testItems.puzzleSnapshot,
    })
    .from(testItems)
    .where(and(skola(ucet, testItems), eq(testItems.testId, id)))
  const keptSnapshots = new Map(
    existing.filter((row) => row.questionSnapshot).map((row) => [row.id, row.questionSnapshot as string]),
  )
  const keptPuzzleSnapshots = new Map(
    existing.filter((row) => row.puzzleSnapshot).map((row) => [row.id, row.puzzleSnapshot as string]),
  )

  const rows = await itemRows(ucet, id, puvodni.kind, items, {
    ids: new Set(existing.map((row) => row.id)),
    snapshots: keptSnapshots,
    puzzleSnapshots: keptPuzzleSnapshots,
  })
  if (rows instanceof Response) return rows

  // Úprava, smazání starých a vložení nových položek naráz: kdyby vložení
  // selhalo, nesmí test zůstat bez položek.
  await db.batch([
    db
      .update(tests)
      .set({
        ...test,
        graded: puvodni.kind === 'pracovni_list' ? false : test.graded,
        // `gradeId` se do `.set()` dává, jen když ho tělo vůbec neslo — jinak
        // by explicitní `undefined` v objektu `.set()` třídu nechtěně smazal.
        ...(gradeId !== undefined ? { gradeId } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tests.id, id), vlastni(ucet, tests))),
    db.delete(testItems).where(and(skola(ucet, testItems), eq(testItems.testId, id))),
    ...(rows.length > 0 ? [db.insert(testItems).values(rows)] : []),
  ])

  // Id položek se vracejí, aby editor při dalším uložení navázal na tytéž
  // položky a jejich zmrazené snímky.
  return Response.json({ id, itemIds: rows.map((row) => row.id) })
    },
    { zapis: true },
  )
}

export async function DELETE(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return Response.json({ error: 'Chybí id' }, { status: 400 })
      const smazano = await db
        .delete(tests)
        .where(and(eq(tests.id, id), vlastni(ucet, tests)))
        .returning({ id: tests.id })
      if (smazano.length === 0) return Response.json({ error: 'Test se nenašel' }, { status: 404 })
      return Response.json({ ok: true })
    },
    { zapis: true },
  )
}

/** Co test už měl: id položek a jejich zmrazené snímky. */
interface KeptItems {
  ids: Set<string>
  snapshots: Map<string, string>
  puzzleSnapshots: Map<string, string>
}

/**
 * Připraví řádky položek testu k vložení. Vrací odpověď, když se něco
 * odmítlo — zapisuje až volající, aby šlo všechno jedním dávkovým zápisem.
 */
async function itemRows(
  ucet: Prihlaseny,
  testId: string,
  kind: TestKind,
  items: Item[],
  kept: KeptItems = { ids: new Set(), snapshots: new Map(), puzzleSnapshots: new Map() },
): Promise<Response | (typeof testItems.$inferInsert & { id: string })[]> {
  if (items.length === 0) return []
  const keptSnapshots = kept.snapshots
  const keptPuzzleSnapshots = kept.puzzleSnapshots

  // Snímek se pořizuje tady na serveru z aktuálního obsahu banky. Klient ho
  // neposílá — jinak by šlo do hotové písemky podstrčit cokoli.
  const snapshots = await buildQuestionSnapshots(
    ucet,
    items
      .filter((item) => item.kind === 'question')
      .map((item) => item.questionId)
      .filter((id): id is string => Boolean(id)),
  )

  // Totéž pro hlavolam: co se zařadilo do písemky, drží snímek. Zmrazit jde
  // ale jen vlastní hlavolam — cizí se sem nedostane ani uhodnutým id.
  const zadaneHlavolamy = items
    .filter((item) => item.kind === 'puzzle')
    .map((item) => item.puzzleId)
    .filter((id): id is string => Boolean(id))
  const puzzleSnapshots = await buildPuzzleSnapshots(ucet, zadaneHlavolamy)
  const cizi = zadaneHlavolamy.filter(
    (id) => !puzzleSnapshots.has(id) && !keptPuzzleSnapshots.has(id),
  )
  if (cizi.length > 0) {
    return Response.json(
      { error: 'Do písemky jde zařadit jen vlastní hlavolam.' },
      { status: 403 },
    )
  }

  // Položka, která v testu už byla, si nechává své id — jen tak na ni editor
  // při dalším uložení naváže i se zmrazeným snímkem.
  const used = new Set<string>()
  const keepId = (id: string | null | undefined): string => {
    const value = id && kept.ids.has(id) && !used.has(id) ? id : newId()
    used.add(value)
    return value
  }

  return items.map((item, index) => {
      const questionId = item.kind === 'question' ? item.questionId : null
      const puzzleId = item.kind === 'puzzle' ? item.puzzleId : null
      return {
        id: keepId(item.id),
        schoolId: ucet.schoolId,
        testId,
        position: index,
        kind: item.kind,
        questionId,
        text: item.kind === 'question' || item.kind === 'puzzle' || item.kind === 'table' ? null : item.text,
        // Obsah prošel kontrolou v `checkItems`; ukládá se v podobě ze schématu.
        content:
          item.kind === 'text'
            ? parseItemContent('text', item.content)
            : item.kind === 'table'
              ? parseItemContent('table', item.content)
              : null,
        needsCheck: item.needsCheck,
        pointsOverride: item.pointsOverride,
        linesOverride: item.kind === 'question' ? item.linesOverride : null,
        // Snímek se pořizuje jednou, při zařazení otázky do testu. U položky,
        // která v testu už byla, se drží ten původní — jinak by přeuložení
        // testu (třeba kvůli opravě názvu) přepsalo obsah už vytištěné
        // písemky aktuálním zněním otázky, čemuž má zmrazení bránit.
        //
        // Úloha pracovního listu v bance není: její obsah upravuje učitelka
        // přímo v listu a snímek posílá klient, takže má přednost i před
        // dříve uloženým snímkem.
        questionSnapshot:
          (kind === 'pracovni_list' && item.kind === 'question' && item.question
            ? serializeQuestionSnapshot(item.question)
            : null) ??
          (item.id ? keptSnapshots.get(item.id) : null) ??
          (questionId ? (snapshots.get(questionId) ?? null) : null),
        puzzleId,
        puzzleSnapshot:
          (item.id ? keptPuzzleSnapshots.get(item.id) : null) ??
          (puzzleId ? (puzzleSnapshots.get(puzzleId) ?? null) : null),
      }
    })
}
