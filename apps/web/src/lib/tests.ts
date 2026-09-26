import 'server-only'
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import {
  resolveTestItemPuzzle,
  resolveTestItemQuestion,
  serializeQuestionSnapshot,
  serializePuzzleSnapshot,
  templateConfigSchema,
  type RenderableTest,
  type ResolvedTestItem,
  type Template,
  type Test,
} from '@testmaker/core/schema'
import { db, assets, grades, puzzles, questions, templates, testItems, tests } from '@/db'
import { skola, viditelnyTest, vlastni, type Scope } from './uzivatel'
import { toQuestion } from './questions'
import { toPuzzle } from './puzzles'

/**
 * Písemka je soukromá: vidí ji autorka, a pokud ji nasdílí (`visibility`),
 * i kolegyně ze školy. Cizí písemka se proto tváří jako neexistující —
 * `null` místo odmítnutí, aby se z odpovědi nedalo vyčíst, že vůbec je.
 */

export interface TestQuery {
  /** Hledá se v názvu a v popisu testu. */
  search?: string
  templateId?: string
}

/**
 * Podmínky pro seznam testů. Hledá se v databázi, ne v prohlížeči — seznam
 * testů se dřív načítal celý bez omezení a loňskou písemku v něm nešlo najít
 * jinak než očima.
 *
 * Na velikosti písmen nezáleží, protože `like` je v SQLite u ASCII necitlivé;
 * u písmen s háčky a čárkami rozlišuje („Řepa" nenajde „řepa"). Na názvy
 * testů, které píše učitelka sama, to stačí — banka otázek na tohle má vlastní
 * sloupec `search_text` s předem převedeným textem.
 *
 * Procenta a podtržítka v hledaném textu jsou v `like` zástupné znaky, proto
 * se odzávorkují; jinak by „100 %" vrátilo všechno.
 */
export function testConditions(scope: Scope, query: TestQuery): SQL[] {
  const viditelne = viditelnyTest(scope, tests)
  const conditions: SQL[] = viditelne ? [viditelne] : []
  const needle = query.search?.trim()
  if (needle) {
    const pattern = `%${needle.replace(/[\\%_]/g, (znak) => `\\${znak}`)}%`
    const match = or(
      sql`${tests.title} like ${pattern} escape '\\'`,
      sql`coalesce(${tests.description}, '') like ${pattern} escape '\\'`,
    )
    if (match) conditions.push(match)
  }
  if (query.templateId) conditions.push(eq(tests.templateId, query.templateId))
  return conditions
}

export async function loadTemplates(scope: Scope): Promise<Template[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(skola(scope, templates))
    .orderBy(asc(templates.position), asc(templates.name))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    config: templateConfigSchema.parse(row.config),
    builtIn: row.builtIn,
  }))
}

export async function loadTest(scope: Scope, testId: string): Promise<Test | null> {
  const [row] = await db
    .select()
    .from(tests)
    .where(and(eq(tests.id, testId), viditelnyTest(scope, tests)))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    ownerId: row.ownerId,
    visibility: row.visibility,
    title: row.title,
    description: row.description,
    graded: row.graded,
    templateId: row.templateId,
    gradeId: row.gradeId,
    header: row.header,
    variants: row.variants === 2 ? 2 : 1,
    showKey: row.showKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Ověří `gradeId` proti škole volající — cizí nebo neexistující ročník se má
 * tiše uložit jako `null`, aby z odpovědi nešlo poznat, že ročník vůbec
 * (v jiné škole) existuje.
 */
export async function resolveGradeId(scope: Scope, gradeId: string | null): Promise<string | null> {
  if (!gradeId) return null
  const [row] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.id, gradeId), skola(scope, grades)))
    .limit(1)
  return row ? row.id : null
}

/**
 * Snímky otázek pro ukládaný test. Vznikají vždy na serveru z aktuálního
 * stavu banky — kdyby je posílal prohlížeč, dal by se obsah písemky
 * podvrhnout.
 */
export async function buildQuestionSnapshots(
  scope: Scope,
  questionIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(questionIds)]
  if (ids.length === 0) return new Map()

  const rows = await db
    .select()
    .from(questions)
    .where(and(skola(scope, questions), inArray(questions.id, ids)))
  const snapshots = new Map<string, string>()
  for (const row of rows) {
    try {
      snapshots.set(row.id, serializeQuestionSnapshot(toQuestion(row)))
    } catch {
      // Otázka, která neprojde schématem (typicky starší data), se prostě
      // nezmrazí — test se kvůli tomu uložit nesmí odmítnout a při
      // vykreslení se sáhne po živé otázce.
    }
  }
  return snapshots
}

/**
 * Snímky hlavolamů pro ukládaný test — týž důvod jako u otázek: co se
 * zařadilo do písemky, nesmí se změnit pozdější úpravou v knihovně.
 */
export async function buildPuzzleSnapshots(
  scope: Scope,
  puzzleIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(puzzleIds)]
  if (ids.length === 0) return new Map()

  // Zmrazit jde jen vlastní hlavolam: bez téhle podmínky by si stačilo
  // uhodnout cizí id a mít ho ve své písemce i ve svém PDF.
  const rows = await db
    .select()
    .from(puzzles)
    .where(and(vlastni(scope, puzzles), inArray(puzzles.id, ids)))
  const snapshots = new Map<string, string>()
  for (const row of rows) {
    try {
      // `serializePuzzleSnapshot` si obsah přečte schématem, takže metadata
      // (id, téma, časy) do snímku neprojdou.
      snapshots.set(row.id, serializePuzzleSnapshot(toPuzzle(row)))
    } catch {
      // Hlavolam, který neprojde schématem, se nezmrazí — test se kvůli tomu
      // uložit neodmítne a při vykreslení se sáhne po živém.
    }
  }
  return snapshots
}

/**
 * Položky testu i s navázanými otázkami, seřazené podle pořadí. Otázka se
 * bere ze snímku pořízeného při uložení testu; živá otázka z banky se použije
 * jen tam, kde snímek chybí (starší testy) nebo je poškozený.
 */
export async function loadTestItems(
  scope: Scope,
  testId: string,
  options: { ownerId?: string } = {},
): Promise<ResolvedTestItem[]> {
  // Položky se čtou přes samotnou písemku, ne jen podle `testId`: kdo na ni
  // nemá vidět, nedostane ani její obsah, i kdyby id uhodl.
  const rows = (
    await db
      .select({ polozka: testItems })
      .from(testItems)
      .innerJoin(tests, eq(tests.id, testItems.testId))
      .where(and(eq(testItems.testId, testId), viditelnyTest(scope, tests)))
      .orderBy(asc(testItems.position))
  ).map((row) => row.polozka)

  // Náhrada za chybějící snímek se u otázky bere z celé školy (banka je
  // společná), u hlavolamu ale jen od vlastníka písemky: nasdílený test by
  // jinak ukázal cizí hlavolam v podobě, do jaké ho autorka mezitím upravila.
  const vlastnikTestu = options.ownerId ?? scope.userId

  const questionIds = rows.map((row) => row.questionId).filter((id): id is string => Boolean(id))
  const questionRows =
    questionIds.length > 0
      ? await db
          .select()
          .from(questions)
          .where(and(skola(scope, questions), inArray(questions.id, questionIds)))
      : []
  const byId = new Map(questionRows.map((row) => [row.id, toQuestion(row)]))

  const puzzleIds = rows.map((row) => row.puzzleId).filter((id): id is string => Boolean(id))
  const puzzleRows =
    puzzleIds.length > 0
      ? await db
          .select()
          .from(puzzles)
          .where(
            and(
              skola(scope, puzzles),
              eq(puzzles.ownerId, vlastnikTestu),
              inArray(puzzles.id, puzzleIds),
            ),
          )
      : []
  const puzzleById = new Map(puzzleRows.map((row) => [row.id, toPuzzle(row)]))

  return rows.map((row) => {
    const live = row.questionId ? (byId.get(row.questionId) ?? null) : null
    const livePuzzle = row.puzzleId ? (puzzleById.get(row.puzzleId) ?? null) : null
    return {
      id: row.id,
      testId: row.testId,
      order: row.position,
      kind: row.kind,
      questionId: row.questionId,
      text: row.text,
      pointsOverride: row.pointsOverride,
      linesOverride: row.linesOverride,
      questionSnapshot: row.questionSnapshot,
      puzzleId: row.puzzleId,
      puzzleSnapshot: row.puzzleSnapshot,
      ...resolveTestItemQuestion(row.questionSnapshot, live, row.id),
      ...(row.kind === 'puzzle' ? resolveTestItemPuzzle(row.puzzleSnapshot, livePuzzle) : {}),
    }
  })
}

/** Obrázky použité v testu jako data URL — react-pdf je vkládá přímo. */
async function loadAssets(scope: Scope, items: ResolvedTestItem[]): Promise<Record<string, string>> {
  const ids = new Set<string>()
  for (const item of items) {
    for (const block of item.question?.blocks ?? []) {
      if (block.kind === 'image') ids.add(block.assetId)
    }
    if (item.question?.type === 'label_image') ids.add(item.question.payload.assetId)
  }
  if (ids.size === 0) return {}

  const rows = await db
    .select()
    .from(assets)
    .where(and(skola(scope, assets), inArray(assets.id, [...ids])))
  return Object.fromEntries(
    rows.map((row) => [row.id, `data:${row.mimeType};base64,${Buffer.from(row.data).toString('base64')}`]),
  )
}

/**
 * Ve kterých viditelných testech otázky už jsou — pro štítek „V testu: …" a
 * filtr „Jen nepoužité v testu" na kartě otázky v tématu.
 *
 * Cizí soukromý test kolegyně otázku prozradit nesmí (bod revize 1 v plánu),
 * proto se testy čtou přes `viditelnyTest`, ne přes pouhou příslušnost ke
 * škole. Test u téže otázky se uvádí jednou, i když v něm otázka figuruje
 * víckrát (rozcvička a pak znovu v jiné části).
 */
export async function loadTestUsageForQuestions(
  scope: Scope,
  questionIds: string[],
): Promise<Record<string, { testId: string; title: string }[]>> {
  const ids = [...new Set(questionIds)]
  if (ids.length === 0) return {}

  const rows = await db
    .select({ questionId: testItems.questionId, testId: tests.id, title: tests.title })
    .from(testItems)
    .innerJoin(tests, eq(tests.id, testItems.testId))
    .where(and(inArray(testItems.questionId, ids), viditelnyTest(scope, tests)))
    .orderBy(desc(tests.updatedAt))

  const usage: Record<string, { testId: string; title: string }[]> = {}
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.questionId) continue
    const key = `${row.questionId}:${row.testId}`
    if (seen.has(key)) continue
    seen.add(key)
    ;(usage[row.questionId] ??= []).push({ testId: row.testId, title: row.title })
  }
  return usage
}

/** Vše potřebné pro vykreslení testu do PDF. */
export async function loadRenderableTest(
  scope: Scope,
  testId: string,
  options: { variant: 'A' | 'B'; withKey: boolean },
): Promise<RenderableTest | null> {
  const test = await loadTest(scope, testId)
  if (!test) return null

  const [templateRow] = await db
    .select()
    .from(templates)
    .where(and(skola(scope, templates), eq(templates.id, test.templateId)))
    .limit(1)
  if (!templateRow) return null

  const items = await loadTestItems(scope, testId, { ownerId: test.ownerId })

  return {
    test,
    template: {
      id: templateRow.id,
      name: templateRow.name,
      description: templateRow.description,
      config: templateConfigSchema.parse(templateRow.config),
      builtIn: templateRow.builtIn,
    },
    items,
    variant: options.variant,
    withKey: options.withKey,
    assets: await loadAssets(scope, items),
  }
}
