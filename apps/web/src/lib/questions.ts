import 'server-only'
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import {
  normalizeEvidence,
  parseQuestionSnapshot,
  type Question,
  type QuestionContent,
  type QuestionStatus,
  type QuestionType,
} from '@testmaker/core/schema'
import { assets, db, questions, testItems, type QuestionRow } from '@/db'
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
