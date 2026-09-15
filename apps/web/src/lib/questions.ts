import 'server-only'
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import {
  type Question,
  type QuestionContent,
  type QuestionStatus,
  type QuestionType,
} from '@testmaker/core/schema'
import { db, questions, type QuestionRow } from '@/db'
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
  const rows = items.map((item) => ({
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
    sourceFile: item.evidence?.fileName ?? null,
    sourceQuote: item.evidence?.quote ?? null,
  }))
  await db.insert(questions).values(rows)
  return rows.map((row) => row.id)
}
