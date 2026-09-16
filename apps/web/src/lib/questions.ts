import 'server-only'
import { and, asc, desc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm'
import {
  normalizeEvidence,
  parseQuestionSnapshot,
  type Question,
  type QuestionContent,
  type QuestionStatus,
  type QuestionType,
} from '@testmaker/core/schema'
import { assets, db, grades, questions, testItems, topics, type QuestionRow } from '@/db'
import { newId } from './ids'

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

export async function loadQuestions(filter: QuestionFilter = {}): Promise<Question[]> {
  const conditions: SQL[] = []
  if (filter.topicIds?.length) conditions.push(inArray(questions.topicId, filter.topicIds))
  if (filter.types?.length) conditions.push(inArray(questions.type, filter.types))
  if (filter.statuses?.length) conditions.push(inArray(questions.status, filter.statuses))
  if (filter.materialId) conditions.push(eq(questions.materialId, filter.materialId))

  const rows = await db
    .select()
    .from(questions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(questions.createdAt), asc(questions.id))
    .limit(filter.limit ?? 500)

  const list = rows.map(toQuestion)
  if (!filter.search) return list

  const needle = filter.search.toLocaleLowerCase('cs')
  return list.filter((question) => questionText(question).toLocaleLowerCase('cs').includes(needle))
}

/** Veškerý text otázky pro fulltextové hledání. */
export function questionText(question: Question): string {
  return JSON.stringify(question.payload)
}

/** Zadání otázky pro výpis v seznamu. */
export function questionPrompt(question: Question): string {
  const payload = question.payload as { prompt?: string; text?: string }
  return payload.prompt || payload.text?.slice(0, 160) || '(bez zadání)'
}

export async function insertQuestions(
  items: QuestionContent[],
  context: { topicId: string; materialId?: string | null; source?: 'ai' | 'manual'; status?: QuestionStatus },
): Promise<string[]> {
  if (items.length === 0) return []
  const rows = items.map((item) => {
    const evidence = normalizeEvidence(item.evidence)
    return {
      id: newId(),
      topicId: context.topicId,
      materialId: context.materialId ?? null,
      type: item.type,
      payload: item.payload,
      blocks: item.blocks ?? [],
      points: item.points,
      difficulty: item.difficulty,
      explanation: item.explanation ?? null,
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
export async function deleteQuestionsWithAssets(ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const targets = await db
    .select({ id: questions.id, type: questions.type, payload: questions.payload, blocks: questions.blocks })
    .from(questions)
    .where(inArray(questions.id, ids))

  const candidateAssetIds = new Set<string>()
  for (const row of targets) {
    for (const assetId of referencedAssetIds(row)) candidateAssetIds.add(assetId)
  }

  await db.delete(questions).where(inArray(questions.id, ids))

  if (candidateAssetIds.size === 0) return

  const remaining = await db
    .select({ type: questions.type, payload: questions.payload, blocks: questions.blocks })
    .from(questions)
  for (const row of remaining) {
    for (const assetId of referencedAssetIds(row)) candidateAssetIds.delete(assetId)
  }

  const snapshotRows = await db.select({ questionSnapshot: testItems.questionSnapshot }).from(testItems)
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
  topicId?: string
  gradeId?: string
  subjectId?: string
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
function queryConditions(query: QuestionQuery): SQL[] {
  const conditions: SQL[] = []
  if (query.statuses?.length) conditions.push(inArray(questions.status, query.statuses))
  if (query.topicId) conditions.push(eq(questions.topicId, query.topicId))
  if (query.gradeId) {
    conditions.push(
      inArray(questions.topicId, db.select({ id: topics.id }).from(topics).where(eq(topics.gradeId, query.gradeId))),
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
          .where(eq(grades.subjectId, query.subjectId)),
      ),
    )
  }
  return conditions
}

/** Kolik otázek filtru odpovídá — číslo „zbývá" nad frontou. */
export async function countQuestions(query: QuestionQuery = {}): Promise<number> {
  const conditions = queryConditions(query)
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(questions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
  return Number(row?.value ?? 0)
}

/**
 * Jedna stránka fronty. Řadí se podle `createdAt` a `id` vzestupně: dvojice je
 * jednoznačná (v jedné milisekundě může vzniknout otázek víc najednou), takže
 * se při posunu kurzorem žádná otázka nezopakuje ani nevynechá.
 */
export async function loadQuestionPage(
  query: QuestionQuery = {},
  options: { limit?: number; cursor?: string | null } = {},
): Promise<{ items: Question[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? QUESTION_PAGE_SIZE, 1), 200)
  const conditions = queryConditions(query)

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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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
  topicId: string,
  from: QuestionStatus,
  to: QuestionStatus,
): Promise<string[]> {
  const where = and(eq(questions.topicId, topicId), eq(questions.status, from))
  const rows = await db.select({ id: questions.id }).from(questions).where(where)
  if (rows.length === 0) return []
  await db.update(questions).set({ status: to }).where(where)
  return rows.map((row) => row.id)
}
