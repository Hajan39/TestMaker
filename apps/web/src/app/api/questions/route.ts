import { and, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { t } from '@testmaker/core/i18n'
import {
  QUESTION_STATUSES,
  QUESTION_TYPES,
  questionContentSchema,
  validateQuestionContent,
} from '@testmaker/core/schema'
import { db, questions } from '@/db'
import {
  QUESTION_PAGE_SIZE,
  countQuestions,
  deleteQuestionsWithAssets,
  insertQuestions,
  loadQuestionPage,
  searchTextFor,
  setStatusForTopic,
  type QuestionQuery,
} from '@/lib/questions'
import { inSchool, withScope } from '@/lib/user'

export const runtime = 'nodejs'

const createSchema = z.object({
  topicId: z.string().min(1),
  question: questionContentSchema,
})

const updateSchema = z.object({
  id: z.string().min(1),
  question: questionContentSchema.optional(),
  status: z.enum(['draft', 'approved', 'rejected']).optional(),
})

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  status: z.enum(['draft', 'approved', 'rejected']),
})

/**
 * Bulk action over a whole topic. A topic can hold over a thousand questions
 * and sending a thousand ids just to change one topic's status makes no
 * sense — the topic id and the source status are enough.
 */
const bulkTopicSchema = z.object({
  topicId: z.string().min(1),
  from: z.enum(['draft', 'approved', 'rejected']).default('draft'),
  status: z.enum(['draft', 'approved', 'rejected']),
})

/** A queue page: filter, size and a cursor past the last question read. */
const listSchema = z.object({
  statuses: z.array(z.enum(QUESTION_STATUSES)).optional(),
  /** Question types; today only direct API calls filter by them, not the app. */
  types: z.array(z.enum(QUESTION_TYPES)).optional(),
  topicId: z.string().optional(),
  gradeId: z.string().optional(),
  subjectId: z.string().optional(),
  /**
   * Search text; compared against the `search_text` column, not in the browser.
   * The app itself doesn't use this parameter — questions are searched only
   * within a topic (`topicId`); it stays for direct API calls and tests.
   */
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(QUESTION_PAGE_SIZE),
  cursor: z.string().optional(),
  /** `desc` = newest first by last status change — the "Smazané" panel. */
  order: z.enum(['asc', 'desc']).optional().default('asc'),
})

/**
 * A page of a topic's questions — today mainly the "Smazané" panel (`status=rejected`).
 * Paged by cursor, not offset: a question that meanwhile drops out of the filter
 * (restored, approved elsewhere) would make an offset skip that many items and
 * the teacher would never see it.
 *
 * Also returns `total` so it can show how many questions match the filter overall.
 */
export async function GET(request: Request) {
  return withScope(async (account) => {
  const params = new URL(request.url).searchParams
  const parsed = listSchema.safeParse({
    statuses: params.getAll('status').length > 0 ? params.getAll('status') : undefined,
    types: params.getAll('type').length > 0 ? params.getAll('type') : undefined,
    q: params.get('q') ?? undefined,
    topicId: params.get('topicId') ?? undefined,
    gradeId: params.get('gradeId') ?? undefined,
    subjectId: params.get('subjectId') ?? undefined,
    limit: params.get('limit') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    order: params.get('order') ?? undefined,
  })
  if (!parsed.success) {
    return Response.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
  }

  const query: QuestionQuery = {
    statuses: parsed.data.statuses,
    types: parsed.data.types,
    topicId: parsed.data.topicId,
    gradeId: parsed.data.gradeId,
    subjectId: parsed.data.subjectId,
    search: parsed.data.q,
  }

  const [page, total] = await Promise.all([
    loadQuestionPage(account, query, {
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
      order: parsed.data.order,
    }),
    countQuestions(account, query),
  ])

  return Response.json({ items: page.items, nextCursor: page.nextCursor, total })
  })
}

/** A teacher's own question. */
export async function POST(request: Request) {
  return withScope(async (account) => {
  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
  }
  const problems = validateQuestionContent(parsed.data.question)
  if (problems.length > 0) return Response.json({ error: problems.join('; ') }, { status: 400 })

  const [id] = await insertQuestions(account, [parsed.data.question], {
    topicId: parsed.data.topicId,
    source: 'manual',
    status: 'approved',
  })
  return Response.json({ id })
  }, { write: true })
}

/** Edit of one question's content or status. */
export async function PATCH(request: Request) {
  return withScope(async (account) => {
  const parsed = updateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (parsed.data.status) {
    update.status = parsed.data.status
    // Approvals and rejections record who decided — the bank is shared.
    update.reviewedBy = account.userId
    update.reviewedAt = new Date().toISOString()
  }
  if (parsed.data.question) {
    const problems = validateQuestionContent(parsed.data.question)
    if (problems.length > 0) return Response.json({ error: problems.join('; ') }, { status: 400 })
    update.type = parsed.data.question.type
    update.payload = parsed.data.question.payload
    update.blocks = parsed.data.question.blocks
    update.points = parsed.data.question.points
    update.difficulty = parsed.data.question.difficulty
    update.explanation = parsed.data.question.explanation ?? null
    // The search text is recomputed with the content — otherwise an edited
    // question could only be found in the bank by its original wording.
    update.searchText = searchTextFor(parsed.data.question)
  }

  await db
    .update(questions)
    .set(update)
    .where(and(inSchool(account, questions), inArray(questions.id, [parsed.data.id])))
  return Response.json({ ok: true })
  }, { write: true })
}

/**
 * Bulk approval or rejection — either by a list of questions or by a whole topic.
 * For a topic the ids of the questions actually changed are returned so the
 * action can be undone precisely: what was approved before must not go back to draft.
 */
export async function PUT(request: Request) {
  return withScope(async (account) => {
  const body = await request.json()

  if (body && typeof body === 'object' && 'topicId' in body) {
    const parsed = bulkTopicSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
    }
    const ids = await setStatusForTopic(account, parsed.data.topicId, parsed.data.from, parsed.data.status)
    return Response.json({ updated: ids.length, ids })
  }

  const parsed = bulkSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
  }
  await db
    .update(questions)
    .set({
      status: parsed.data.status,
      reviewedBy: account.userId,
      reviewedAt: new Date().toISOString(),
    })
    .where(and(inSchool(account, questions), inArray(questions.id, parsed.data.ids)))
  return Response.json({ updated: parsed.data.ids.length })
  }, { write: true })
}

export async function DELETE(request: Request) {
  return withScope(async (account) => {
    const ids = new URL(request.url).searchParams.getAll('id')
    if (ids.length === 0) return Response.json({ error: t('api:invalidRequest') }, { status: 400 })
    await deleteQuestionsWithAssets(account, ids)
    return Response.json({ deleted: ids.length })
  }, { write: true })
}
