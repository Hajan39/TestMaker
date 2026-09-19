import 'server-only'
import { and, asc, desc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm'
import { AVOID_LIMIT } from '@testmaker/core/ai'
import {
  normalizeEvidence,
  parseQuestionSnapshot,
  type Question,
  type QuestionContent,
  type QuestionStatus,
  type QuestionType,
} from '@testmaker/core/schema'
import { assets, db, grades, materials, questions, testItems, topics, type QuestionRow } from '@/db'
import { skola, type Scope } from './uzivatel'
import { newId } from './ids'

/**
 * Banka je společná pro celou školu: schvaluje a opravuje kdokoli, kdo smí
 * měnit obsah. Co společné není, je škola sama — rozsah proto chodí jako
 * první parametr a bez něj se dotaz nedá napsat.
 */

/** Řádek z databáze na doménovou otázku. */
export function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    topicId: row.topicId,
    materialId: row.materialId,
    source: row.source,
    status: row.status,
    createdAt: row.createdAt,
    type: row.type,
    payload: row.payload,
    blocks: row.blocks ?? [],
    points: row.points,
    difficulty: (row.difficulty as 1 | 2 | 3) ?? 2,
    explanation: row.explanation ?? undefined,
    evidence: row.sourceFile ? { fileName: row.sourceFile, quote: row.sourceQuote ?? '' } : undefined,
  } as Question
}

export interface QuestionFilter {
  topicIds?: string[]
  types?: QuestionType[]
  statuses?: QuestionStatus[]
  materialId?: string
  search?: string
  limit?: number
}

/** Kolik otázek `loadQuestions` vrátí, když si volající neřekne jinak. */
export const QUESTION_LIST_LIMIT = 500

export interface QuestionList {
  items: Question[]
  /**
   * Otázek bylo víc, než se vešlo do limitu — vrácený seznam tedy není úplný.
   * Volající to musí dát najevo: mlčky useknutý seznam vypadá jako celá banka
   * a učitelka by marně hledala otázku, která v něm prostě není.
   */
  truncated: boolean
  /** Limit, o který se seznam usekl — do hlášky pro učitelku. */
  limit: number
}

export async function loadQuestions(scope: Scope, filter: QuestionFilter = {}): Promise<QuestionList> {
  const limit = filter.limit ?? QUESTION_LIST_LIMIT
  const conditions: SQL[] = [skola(scope, questions)]
  if (filter.topicIds?.length) conditions.push(inArray(questions.topicId, filter.topicIds))
  if (filter.types?.length) conditions.push(inArray(questions.type, filter.types))
  if (filter.statuses?.length) conditions.push(inArray(questions.status, filter.statuses))
  if (filter.materialId) conditions.push(eq(questions.materialId, filter.materialId))

  // O jednu navíc: podle toho se pozná, že seznam není úplný.
  const rows = await db
    .select()
    .from(questions)
    .where(and(...conditions))
    .orderBy(desc(questions.createdAt), asc(questions.id))
    .limit(limit + 1)

  const truncated = rows.length > limit
  const list = rows.slice(0, limit).map(toQuestion)
  if (!filter.search) return { items: list, truncated, limit }

  const needle = filter.search.toLocaleLowerCase('cs')
  return {
    items: list.filter((question) => questionText(question).toLocaleLowerCase('cs').includes(needle)),
    truncated,
    limit,
  }
}

/** Veškerý text otázky pro fulltextové hledání. */
export function questionText(question: Question): string {
  return JSON.stringify(question.payload)
}

/**
 * Obsah sloupce `questions.search_text`: všechen text otázky malými písmeny.
 *
 * Malá písmena se dělají tady v JavaScriptu, ne až v dotazu — `lower()`
 * v SQLite umí jen ASCII a hledání podle „řeka“ by minulo otázku, která má
 * v zadání „Řeka“. Uloží se proto rovnou převedené a hledá se nad tím.
 */
export function searchTextFor(content: { payload: unknown; explanation?: string | null }): string {
  return `${JSON.stringify(content.payload)} ${content.explanation ?? ''}`.toLocaleLowerCase('cs')
}

/**
 * Podmínka hledání nad `search_text`. Procenta a podtržítka v hledaném textu
 * jsou v `LIKE` zástupné znaky — kdo hledá „50 %", nechce dostat všechno.
 */
export function searchCondition(search: string): SQL | null {
  const needle = search.trim().toLocaleLowerCase('cs')
  if (!needle) return null
  const pattern = `%${needle.replace(/[\\%_]/g, (znak) => `\\${znak}`)}%`
  return sql`${questions.searchText} like ${pattern} escape '\\'`
}

/** Zadání otázky pro výpis v seznamu. */
export function questionPrompt(question: { payload: unknown }): string {
  const payload = question.payload as { prompt?: string; text?: string }
  return payload.prompt || payload.text?.slice(0, 160) || '(bez zadání)'
}

/**
 * Zadání otázek tématu pro seznam „těmhle se vyhni" v promptu.
 *
 * Bere se přesně tolik, kolik se do promptu vejde (`AVOID_LIMIT`), a od těch
 * nejnovějších: právě jim se model musí vyhnout nejvíc, protože z nich se
 * naposledy generovalo. Dřív se načítalo osmdesát otázek bez řazení, takže
 * o výběru rozhodovalo pořadí řádků v databázi, a prompt pak seznam ořezával
 * podruhé.
 */
export async function loadAvoidPrompts(
  scope: Scope,
  topicId: string,
  limit = AVOID_LIMIT,
): Promise<string[]> {
  const rows = await db
    .select({ payload: questions.payload })
    .from(questions)
    .where(and(skola(scope, questions), eq(questions.topicId, topicId)))
    .orderBy(desc(questions.createdAt), desc(questions.id))
    .limit(limit)
  return rows.map((row) => questionPrompt(row))
}

/**
 * Materiály tématu podle názvu souboru, pro dohledání původu otázky.
 *
 * Generování běží nad celým tématem, takže volající materiál nezná — jediné,
 * co o původu otázky víme, je název souboru z dokladu (`evidence.fileName`,
 * záhlaví `=== … ===` ve zdrojovém textu). Vazba je přitom potřeba: když se
 * materiál přesune do jiného tématu, mají s ním odejít i jeho otázky.
 *
 * Název souboru se smí v tématu opakovat (tentýž název na jiné cestě). Takový
 * název se do mapy nedostane vůbec: přiřadit otázku k jednomu ze dvou stejně
 * pojmenovaných materiálů by byla hádanka, a přesunout ji podle špatného
 * tipu je horší, než ji nechat být.
 */
async function materialsByFileName(
  scope: Scope,
  topicId: string,
): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ id: materials.id, fileName: materials.fileName })
    .from(materials)
    .where(and(skola(scope, materials), eq(materials.topicId, topicId)))

  const byName = new Map<string, string | null>()
  for (const row of rows) byName.set(row.fileName, byName.has(row.fileName) ? null : row.id)
  return byName
}

export async function insertQuestions(
  scope: Scope,
  items: QuestionContent[],
  context: { topicId: string; materialId?: string | null; source?: 'ai' | 'manual'; status?: QuestionStatus },
): Promise<string[]> {
  if (items.length === 0) return []
  // Materiál od volajícího má přednost; jinak se hledá podle dokladu původu.
  const byName =
    context.materialId === undefined && items.some((item) => item.evidence)
      ? await materialsByFileName(scope, context.topicId)
      : new Map<string, string | null>()

  const rows = items.map((item) => {
    const evidence = normalizeEvidence(item.evidence)
    return {
      id: newId(),
      schoolId: scope.schoolId,
      // Kdo otázku nechal vzniknout. U běhu z fronty je to zadavatelka úlohy,
      // ne ten, kdo zrovna otevřel okno.
      createdBy: scope.userId,
      topicId: context.topicId,
      // Podle `item.evidence`, ne podle `evidence`: bez citace se doklad
      // normalizuje na null, ale název souboru v něm pořád je a na dohledání
      // materiálu stačí.
      materialId: context.materialId ?? (item.evidence ? (byName.get(item.evidence.fileName) ?? null) : null),
      type: item.type,
      payload: item.payload,
      blocks: item.blocks ?? [],
      points: item.points,
      difficulty: item.difficulty,
      explanation: item.explanation ?? null,
      searchText: searchTextFor(item),
      source: context.source ?? 'ai',
      status: context.status ?? 'draft',
      sourceFile: evidence?.fileName ?? null,
      sourceQuote: evidence?.quote ?? null,
    }
  })
  await db.insert(questions).values(rows)
  return rows.map((row) => row.id)
}

/** Přílohy (`assets`), na které se odkazuje zadání otázky nebo její přílohové bloky. */
function referencedAssetIds(row: {
  type: QuestionRow['type']
  payload: QuestionRow['payload']
  blocks: QuestionRow['blocks']
}): string[] {
  const ids: string[] = []
  for (const block of row.blocks ?? []) {
    if (block.kind === 'image') ids.push(block.assetId)
  }
  if (row.type === 'label_image') {
    const payload = row.payload as { assetId?: string }
    if (payload.assetId) ids.push(payload.assetId)
  }
  return ids
}

/**
 * Smaže otázky a uvolněné přílohy (`assets`), na které se odkazovaly jejich
 * bloky nebo payload typu `label_image` — jinak by obrázek zůstal v databázi
 * navždy i po smazání jediné otázky, která ho používala.
 *
 * `test_items.question_id` na smazanou otázku odkazuje s `onDelete: 'set null'`
 * — položka v hotovém testu se tím neztratí, protože co je na papíře, drží
 * `question_snapshot`. Proto se do kontroly použití počítají i přílohy
 * odkazované ze zmrazených snímků, ne jen z živých otázek — jinak by smazání
 * otázky z banky vzalo obrázek i testu, který si ji zamrazil.
 */
export async function deleteQuestionsWithAssets(scope: Scope, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const targets = await db
    .select({ id: questions.id, type: questions.type, payload: questions.payload, blocks: questions.blocks })
    .from(questions)
    .where(and(skola(scope, questions), inArray(questions.id, ids)))

  const candidateAssetIds = new Set<string>()
  for (const row of targets) {
    for (const assetId of referencedAssetIds(row)) candidateAssetIds.add(assetId)
  }

  // Maže se jen to, co skutečně patří téhle škole — cizí id se tiše přeskočí.
  const mazane = targets.map((row) => row.id)
  if (mazane.length === 0) return
  await db.delete(questions).where(inArray(questions.id, mazane))

  if (candidateAssetIds.size === 0) return

  const remaining = await db
    .select({ type: questions.type, payload: questions.payload, blocks: questions.blocks })
    .from(questions)
    .where(skola(scope, questions))
  for (const row of remaining) {
    for (const assetId of referencedAssetIds(row)) candidateAssetIds.delete(assetId)
  }

  /*
   * Zmrazené snímky se čtou napříč všemi učitelkami školy, ne jen svoje:
   * kdyby se obrázek smazal jen proto, že ho drží cizí už vytištěná písemka,
   * zmizel by jí ze zadání. Je to jediné místo, kde se do cizích testů sahá,
   * a nevychází z něj nic než identifikátory příloh.
   */
  const snapshotRows = await db
    .select({ questionSnapshot: testItems.questionSnapshot })
    .from(testItems)
    .where(skola(scope, testItems))
  for (const row of snapshotRows) {
    const snapshot = parseQuestionSnapshot(row.questionSnapshot)
    if (!snapshot) continue
    for (const assetId of referencedAssetIds(snapshot)) candidateAssetIds.delete(assetId)
  }

  if (candidateAssetIds.size === 0) return
  await db.delete(assets).where(inArray(assets.id, [...candidateAssetIds]))
}

/**
 * Filtr pro frontu ke kontrole. Na rozdíl od `QuestionFilter` výš míří na
 * jedno patro knihovny (téma, ročník, předmět), ne na výčet témat — obrazovka
 * kontroly se zužuje právě takhle a seznam témat celého předmětu by se do
 * adresy nevešel.
 */
export interface QuestionQuery {
  statuses?: QuestionStatus[]
  types?: QuestionType[]
  topicId?: string
  gradeId?: string
  subjectId?: string
  /** Hledaný text; porovnává se se sloupcem `search_text`. */
  search?: string
}

/** Kolik otázek se v jedné stránce fronty načte, když si volající neřekne jinak. */
export const QUESTION_PAGE_SIZE = 20

export interface QuestionCursor {
  createdAt: string
  id: string
}

/**
 * Kurzor je poslední přečtená dvojice (createdAt, id) v base64. Stránkuje se
 * kurzorem, ne offsetem: schválením otázka z výsledku vypadne a offset by o
 * tolik položek přeskočil dál — učitelka by je nikdy neuviděla.
 *
 * Oddělovačem je svislítko: v čase ve tvaru ISO ani v id (nanoid) se nevyskytuje.
 */
export function encodeCursor(cursor: QuestionCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(value: string | null | undefined): QuestionCursor | null {
  if (!value) return null
  const [createdAt, id] = Buffer.from(value, 'base64url').toString('utf8').split('|')
  if (!createdAt || !id) return null
  return { createdAt, id }
}

/** Podmínky filtru; patro knihovny nad tématem se řeší poddotazem nad `topics`. */
function queryConditions(scope: Scope, query: QuestionQuery): SQL[] {
  const conditions: SQL[] = [skola(scope, questions)]
  if (query.statuses?.length) conditions.push(inArray(questions.status, query.statuses))
  if (query.types?.length) conditions.push(inArray(questions.type, query.types))
  if (query.topicId) conditions.push(eq(questions.topicId, query.topicId))
  if (query.gradeId) {
    conditions.push(
      inArray(
        questions.topicId,
        db
          .select({ id: topics.id })
          .from(topics)
          .where(and(skola(scope, topics), eq(topics.gradeId, query.gradeId))),
      ),
    )
  }
  if (query.subjectId) {
    conditions.push(
      inArray(
        questions.topicId,
        db
          .select({ id: topics.id })
          .from(topics)
          .innerJoin(grades, eq(grades.id, topics.gradeId))
          .where(and(skola(scope, topics), eq(grades.subjectId, query.subjectId))),
      ),
    )
  }
  if (query.search) {
    const condition = searchCondition(query.search)
    if (condition) conditions.push(condition)
  }
  return conditions
}

/** Kolik otázek filtru odpovídá — číslo „zbývá" nad frontou. */
export async function countQuestions(scope: Scope, query: QuestionQuery = {}): Promise<number> {
  const conditions = queryConditions(scope, query)
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(questions)
    .where(and(...conditions))
  return Number(row?.value ?? 0)
}

/**
 * Jedna stránka fronty. Řadí se podle `createdAt` a `id` vzestupně: dvojice je
 * jednoznačná (v jedné milisekundě může vzniknout otázek víc najednou), takže
 * se při posunu kurzorem žádná otázka nezopakuje ani nevynechá.
 */
export async function loadQuestionPage(
  scope: Scope,
  query: QuestionQuery = {},
  options: { limit?: number; cursor?: string | null } = {},
): Promise<{ items: Question[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? QUESTION_PAGE_SIZE, 1), 200)
  const conditions = queryConditions(scope, query)

  const cursor = decodeCursor(options.cursor)
  if (cursor) {
    const after = or(
      gt(questions.createdAt, cursor.createdAt),
      and(eq(questions.createdAt, cursor.createdAt), gt(questions.id, cursor.id)),
    )
    if (after) conditions.push(after)
  }

  // O jednu navíc: podle toho se pozná, jestli má smysl nabízet další stránku.
  const rows = await db
    .select()
    .from(questions)
    .where(and(...conditions))
    .orderBy(asc(questions.createdAt), asc(questions.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page.map(toQuestion),
    nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  }
}

/**
 * Hromadná změna stavu celého tématu. Posílat tisíc identifikátorů jen proto,
 * aby se schválilo jedno téma, nemá smysl — sem jde jen id tématu a výchozí
 * stav. Vrací id skutečně změněných otázek, aby šlo akci vzít zpět přesně:
 * otázky, které v cílovém stavu byly už předtím, se vracet nesmějí.
 */
export async function setStatusForTopic(
  scope: Scope,
  topicId: string,
  from: QuestionStatus,
  to: QuestionStatus,
): Promise<string[]> {
  const where = and(
    skola(scope, questions),
    eq(questions.topicId, topicId),
    eq(questions.status, from),
  )
  const rows = await db.select({ id: questions.id }).from(questions).where(where)
  if (rows.length === 0) return []
  await db
    .update(questions)
    .set({ status: to, reviewedBy: scope.userId, reviewedAt: new Date().toISOString() })
    .where(where)
  return rows.map((row) => row.id)
}
