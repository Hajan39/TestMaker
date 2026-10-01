import 'server-only'
import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { AI_SETTINGS } from '@testmaker/core/ai'
import {
  normalizeEvidence,
  parseQuestionSnapshot,
  type Question,
  type QuestionContent,
  type QuestionStatus,
  type QuestionType,
} from '@testmaker/core/schema'
import { assets, db, grades, materials, questions, testItems, topics, type QuestionRow } from '@/db'
import { inSchool, type Scope } from './user'
import { newId } from './ids'
import { t } from '@testmaker/core/i18n'

/**
 * The bank is shared by the whole school: anyone allowed to change content
 * approves and fixes questions. What isn't shared is the school itself — the
 * scope is therefore the first parameter and no query can be written without it.
 */

/** Database row to domain question. */
export function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    topicId: row.topicId,
    materialId: row.materialId,
    variantOf: row.variantOf,
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

/** How many questions `loadQuestions` returns unless the caller says otherwise. */
export const QUESTION_LIST_LIMIT = 500

export interface QuestionList {
  items: Question[]
  /**
   * There were more questions than the limit — the returned list is incomplete.
   * The caller must show it: a silently truncated list looks like all the
   * questions and the teacher would search in vain for one that just isn't there.
   */
  truncated: boolean
  /** The limit the list was cut at — for the teacher-facing message. */
  limit: number
}

export async function loadQuestions(scope: Scope, filter: QuestionFilter = {}): Promise<QuestionList> {
  const limit = filter.limit ?? QUESTION_LIST_LIMIT
  const conditions: SQL[] = [inSchool(scope, questions)]
  if (filter.topicIds?.length) conditions.push(inArray(questions.topicId, filter.topicIds))
  if (filter.types?.length) conditions.push(inArray(questions.type, filter.types))
  if (filter.statuses?.length) conditions.push(inArray(questions.status, filter.statuses))
  if (filter.materialId) conditions.push(eq(questions.materialId, filter.materialId))

  // One extra: tells whether the list is incomplete.
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

/** All question text for full-text search. */
export function questionText(question: Question): string {
  return JSON.stringify(question.payload)
}

/**
 * Content of the `questions.search_text` column: all question text in lower case.
 *
 * Lower-casing happens here in JavaScript, not in the query — SQLite's `lower()`
 * only handles ASCII and a search for "řeka" would miss a question whose prompt
 * has "Řeka". So the folded text is stored and searched directly.
 */
export function searchTextFor(content: { payload: unknown; explanation?: string | null }): string {
  return `${JSON.stringify(content.payload)} ${content.explanation ?? ''}`.toLocaleLowerCase('cs')
}

/**
 * Search condition over `search_text`. Percent signs and underscores in the
 * search text are `LIKE` wildcards — searching for "50 %" shouldn't match everything.
 */
export function searchCondition(search: string): SQL | null {
  const needle = search.trim().toLocaleLowerCase('cs')
  if (!needle) return null
  const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  return sql`${questions.searchText} like ${pattern} escape '\\'`
}

/** Question prompt for list display. */
export function questionPrompt(question: { payload: unknown }): string {
  const payload = question.payload as { prompt?: string; text?: string }
  return payload.prompt || payload.text?.slice(0, 160) || t('library:questions.noPrompt')
}

/**
 * Prompts of the topic's questions for the "avoid these" list in the prompt.
 *
 * Takes exactly as many as fit in the prompt (`AI_SETTINGS.avoidLimit`), newest
 * first: those are what the model must avoid most, since they were generated
 * last. Previously eighty questions were loaded unordered, so the database row
 * order decided the selection, and the prompt then trimmed the list a second time.
 */
export async function loadAvoidPrompts(
  scope: Scope,
  topicId: string,
  limit: number = AI_SETTINGS.avoidLimit,
): Promise<string[]> {
  const rows = await db
    .select({ payload: questions.payload })
    .from(questions)
    .where(and(inSchool(scope, questions), eq(questions.topicId, topicId)))
    .orderBy(desc(questions.createdAt), desc(questions.id))
    .limit(limit)
  return rows.map((row) => questionPrompt(row))
}

/** One version of a root question, as the question card in the overview needs it. */
export interface VariantLink {
  id: string
  difficulty: 1 | 2 | 3
  status: QuestionStatus
}

/**
 * Versions (easier/harder) of the questions in `questionIds`, grouped by root.
 *
 * A question can be the root of its own versions and also a version of another
 * — so `variantOf` is queried across the whole question, not just whose
 * `questionIds` it is. The card over a root then sees all its versions together,
 * whether it shows the root or one of its versions.
 */
export async function loadVariantLinks(
  scope: Scope,
  questionIds: string[],
): Promise<Record<string, VariantLink[]>> {
  if (questionIds.length === 0) return {}
  const rows = await db
    .select({ id: questions.id, variantOf: questions.variantOf, difficulty: questions.difficulty, status: questions.status })
    .from(questions)
    .where(and(inSchool(scope, questions), inArray(questions.variantOf, questionIds)))

  const result: Record<string, VariantLink[]> = {}
  for (const row of rows) {
    if (!row.variantOf) continue
    const list = result[row.variantOf] ?? (result[row.variantOf] = [])
    list.push({ id: row.id, difficulty: (row.difficulty as 1 | 2 | 3) ?? 2, status: row.status })
  }
  return result
}

/**
 * The topic's materials by file name, for tracing a question's origin.
 *
 * Generation runs over the whole topic, so the caller doesn't know the material
 * — the only thing we know about a question's origin is the file name from its
 * evidence (`evidence.fileName`, the `=== … ===` header in the source text). The
 * link is needed though: when a material moves to another topic, its questions
 * must move with it.
 *
 * A file name may repeat within a topic (same name on another path). Such a
 * name never enters the map: assigning the question to one of two identically
 * named materials would be a guess, and moving it on a wrong guess is worse
 * than leaving it alone.
 */
async function materialsByFileName(
  scope: Scope,
  topicId: string,
): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ id: materials.id, fileName: materials.fileName })
    .from(materials)
    .where(and(inSchool(scope, materials), eq(materials.topicId, topicId)))

  const byName = new Map<string, string | null>()
  for (const row of rows) byName.set(row.fileName, byName.has(row.fileName) ? null : row.id)
  return byName
}

export async function insertQuestions(
  scope: Scope,
  items: QuestionContent[],
  context: {
    topicId: string
    materialId?: string | null
    source?: 'ai' | 'manual'
    status?: QuestionStatus
    /** Root of which the inserted question is an easier or harder version. */
    variantOf?: string | null
  },
): Promise<string[]> {
  if (items.length === 0) return []
  // The caller's material wins; otherwise it is looked up from the evidence.
  const byName =
    context.materialId === undefined && items.some((item) => item.evidence)
      ? await materialsByFileName(scope, context.topicId)
      : new Map<string, string | null>()

  const rows = items.map((item) => {
    const evidence = normalizeEvidence(item.evidence)
    return {
      id: newId(),
      schoolId: scope.schoolId,
      // Who caused the question to be created. For a queued run that's the
      // job's requester, not whoever happens to have the window open.
      createdBy: scope.userId,
      topicId: context.topicId,
      variantOf: context.variantOf ?? null,
      // From `item.evidence`, not `evidence`: without a quote the evidence is
      // normalised to null, but the file name is still in it and is enough to
      // find the material.
      materialId: context.materialId ?? (item.evidence ? (byName.get(item.evidence.fileName) ?? null) : null),
      type: item.type,
      payload: item.payload,
      blocks: item.blocks ?? [],
      points: item.points,
      difficulty: item.difficulty,
      explanation: item.explanation ?? null,
      searchText: searchTextFor(item),
      source: context.source ?? 'ai',
      // Draft approval is gone — the question is usable right away. `draft`
      // stays in `QuestionStatus` only for older rows and the migration rollback.
      status: context.status ?? 'approved',
      sourceFile: evidence?.fileName ?? null,
      sourceQuote: evidence?.quote ?? null,
    }
  })
  await db.insert(questions).values(rows)
  return rows.map((row) => row.id)
}

/** Assets referenced by the question prompt or its asset blocks. */
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
 * Deletes questions and freed assets referenced by their blocks or a
 * `label_image` payload — otherwise the image would stay in the database
 * forever even after the only question using it was deleted.
 *
 * `test_items.question_id` references the deleted question with
 * `onDelete: 'set null'` — the item in a finished test isn't lost, because
 * what's on paper is held by `question_snapshot`. That's why the usage check
 * also counts assets referenced from frozen snapshots, not just live questions
 * — otherwise deleting a question from the bank would take the image from a
 * test that froze it too.
 */
export async function deleteQuestionsWithAssets(scope: Scope, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const targets = await db
    .select({ id: questions.id, type: questions.type, payload: questions.payload, blocks: questions.blocks })
    .from(questions)
    .where(and(inSchool(scope, questions), inArray(questions.id, ids)))

  const candidateAssetIds = new Set<string>()
  for (const row of targets) {
    for (const assetId of referencedAssetIds(row)) candidateAssetIds.add(assetId)
  }

  // Only what really belongs to this school is deleted — foreign ids are silently skipped.
  const deletedIds = targets.map((row) => row.id)
  if (deletedIds.length === 0) return
  await db.delete(questions).where(inArray(questions.id, deletedIds))

  if (candidateAssetIds.size === 0) return

  const remaining = await db
    .select({ type: questions.type, payload: questions.payload, blocks: questions.blocks })
    .from(questions)
    .where(inSchool(scope, questions))
  for (const row of remaining) {
    for (const assetId of referencedAssetIds(row)) candidateAssetIds.delete(assetId)
  }

  /*
   * Frozen snapshots are read across all teachers of the school, not just
   * one's own: if an image were deleted only because someone else's already
   * printed test holds it, it would vanish from that test. This is the only
   * place that reaches into other people's tests, and nothing but asset ids comes out of it.
   */
  const snapshotRows = await db
    .select({ questionSnapshot: testItems.questionSnapshot })
    .from(testItems)
    .where(inSchool(scope, testItems))
  for (const row of snapshotRows) {
    const snapshot = parseQuestionSnapshot(row.questionSnapshot)
    if (!snapshot) continue
    for (const assetId of referencedAssetIds(snapshot)) candidateAssetIds.delete(assetId)
  }

  if (candidateAssetIds.size === 0) return
  await db.delete(assets).where(inArray(assets.id, [...candidateAssetIds]))
}

/**
 * Filter for the paged queue (`GET /api/questions` — today mainly the
 * "Smazané" panel in a topic). Unlike `QuestionFilter` above it targets one
 * library level (topic, grade, subject), not a list of topics — the topic list
 * of a whole subject wouldn't fit in the URL.
 */
export interface QuestionQuery {
  statuses?: QuestionStatus[]
  types?: QuestionType[]
  topicId?: string
  gradeId?: string
  subjectId?: string
  /** Search text; compared against the `search_text` column. */
  search?: string
}

/** How many questions one queue page loads unless the caller says otherwise. */
export const QUESTION_PAGE_SIZE = 20

export interface QuestionCursor {
  /** Sort column value of the last item read — `createdAt` (default order)
   *  or `reviewedAt`/`createdAt` for the newest-first "Smazané" order. */
  at: string
  id: string
}

/**
 * The cursor is the last read pair (sort column, id) in base64. Paging uses a
 * cursor, not an offset: approving a question drops it from the result and an
 * offset would skip that many items — the teacher would never see them.
 *
 * The separator is a pipe: it never occurs in an ISO timestamp or an id (nanoid).
 */
export function encodeCursor(cursor: QuestionCursor): string {
  return Buffer.from(`${cursor.at}|${cursor.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(value: string | null | undefined): QuestionCursor | null {
  if (!value) return null
  const [at, id] = Buffer.from(value, 'base64url').toString('utf8').split('|')
  if (!at || !id) return null
  return { at, id }
}

/** Filter conditions; library levels above the topic use a subquery over `topics`. */
function queryConditions(scope: Scope, query: QuestionQuery): SQL[] {
  const conditions: SQL[] = [inSchool(scope, questions)]
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
          .where(and(inSchool(scope, topics), eq(topics.gradeId, query.gradeId))),
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
          .where(and(inSchool(scope, topics), eq(grades.subjectId, query.subjectId))),
      ),
    )
  }
  if (query.search) {
    const condition = searchCondition(query.search)
    if (condition) conditions.push(condition)
  }
  return conditions
}

/** How many questions match the filter — the "remaining" number above the queue. */
export async function countQuestions(scope: Scope, query: QuestionQuery = {}): Promise<number> {
  const conditions = queryConditions(scope, query)
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(questions)
    .where(and(...conditions))
  return Number(row?.value ?? 0)
}

/**
 * One queue page. Sorted by `createdAt` and `id` ascending (default); the pair
 * is unique (several questions can be created in one millisecond), so moving
 * the cursor never repeats or skips a question.
 *
 * `order: 'desc'` sorts newest first by when something last happened to the
 * question (`reviewedAt`, or `createdAt` for untouched questions) — used by the
 * "Smazané" panel in a topic, where what the teacher deleted last belongs on top.
 */
export async function loadQuestionPage(
  scope: Scope,
  query: QuestionQuery = {},
  options: { limit?: number; cursor?: string | null; order?: 'asc' | 'desc' } = {},
): Promise<{ items: Question[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? QUESTION_PAGE_SIZE, 1), 200)
  const order = options.order ?? 'asc'
  const conditions = queryConditions(scope, query)

  // Ascending order (queue) relies purely on `createdAt`; descending ("Smazané"
  // panel) on the moment of the last status change, with `createdAt` as a
  // fallback for questions nobody has touched yet.
  const sortColumn: SQL<string> =
    order === 'desc'
      ? sql<string>`coalesce(${questions.reviewedAt}, ${questions.createdAt})`
      : sql<string>`${questions.createdAt}`

  const cursor = decodeCursor(options.cursor)
  if (cursor) {
    const after =
      order === 'desc'
        ? or(lt(sortColumn, cursor.at), and(eq(sortColumn, cursor.at), lt(questions.id, cursor.id)))
        : or(gt(sortColumn, cursor.at), and(eq(sortColumn, cursor.at), gt(questions.id, cursor.id)))
    if (after) conditions.push(after)
  }

  // One extra: tells whether offering another page makes sense.
  const rows = await db
    .select()
    .from(questions)
    .where(and(...conditions))
    .orderBy(
      order === 'desc' ? desc(sortColumn) : asc(sortColumn),
      order === 'desc' ? desc(questions.id) : asc(questions.id),
    )
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const lastAt = last ? (order === 'desc' ? (last.reviewedAt ?? last.createdAt) : last.createdAt) : null
  return {
    items: page.map(toQuestion),
    nextCursor: rows.length > limit && last && lastAt ? encodeCursor({ at: lastAt, id: last.id }) : null,
  }
}

/**
 * Bulk status change of a whole topic. Sending a thousand ids just to approve
 * one topic makes no sense — only the topic id and the source status go here.
 * Returns the ids of the questions actually changed so the action can be undone
 * precisely: questions already in the target status must not be reverted.
 */
export async function setStatusForTopic(
  scope: Scope,
  topicId: string,
  from: QuestionStatus,
  to: QuestionStatus,
): Promise<string[]> {
  const where = and(
    inSchool(scope, questions),
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
