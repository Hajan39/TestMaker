import { and, inArray } from 'drizzle-orm'
import { z } from 'zod'
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
import { skola, sRozsahem } from '@/lib/uzivatel'

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
 * Hromadná akce nad celým tématem. Fronta ke kontrole jich umí mít přes tisíc
 * a posílat tisíc identifikátorů jen proto, aby se schválilo jedno téma, nemá
 * smysl — stačí id tématu a stav, ze kterého se má měnit.
 */
const bulkTopicSchema = z.object({
  topicId: z.string().min(1),
  from: z.enum(['draft', 'approved', 'rejected']).default('draft'),
  status: z.enum(['draft', 'approved', 'rejected']),
})

/** Stránka fronty: filtr, velikost a kurzor za poslední přečtenou otázkou. */
const listSchema = z.object({
  statuses: z.array(z.enum(QUESTION_STATUSES)).optional(),
  /** Typy otázek — banka se jimi zužuje, fronta ke kontrole je neposílá. */
  types: z.array(z.enum(QUESTION_TYPES)).optional(),
  topicId: z.string().optional(),
  gradeId: z.string().optional(),
  subjectId: z.string().optional(),
  /** Hledaný text; porovnává se se sloupcem `search_text`, ne v prohlížeči. */
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(QUESTION_PAGE_SIZE),
  cursor: z.string().optional(),
})

/**
 * Stránka otázek pro obrazovku kontroly. Stránkuje se kurzorem, ne offsetem:
 * schválená otázka z výsledku vypadne a offset by o tolik položek přeskočil
 * dál — učitelka by je nikdy neuviděla.
 *
 * Vrací i `total`, aby šlo nad frontou ukázat, kolik práce ještě zbývá.
 */
export async function GET(request: Request) {
  return sRozsahem(async (ucet) => {
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
  })
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
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
    loadQuestionPage(ucet, query, { limit: parsed.data.limit, cursor: parsed.data.cursor }),
    countQuestions(ucet, query),
  ])

  return Response.json({ items: page.items, nextCursor: page.nextCursor, total })
  })
}

/** Vlastní otázka učitele. */
export async function POST(request: Request) {
  return sRozsahem(async (ucet) => {
  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }
  const problems = validateQuestionContent(parsed.data.question)
  if (problems.length > 0) return Response.json({ error: problems.join('; ') }, { status: 400 })

  const [id] = await insertQuestions(ucet, [parsed.data.question], {
    topicId: parsed.data.topicId,
    source: 'manual',
    status: 'approved',
  })
  return Response.json({ id })
  }, { zapis: true })
}

/** Úprava obsahu nebo stavu jedné otázky. */
export async function PATCH(request: Request) {
  return sRozsahem(async (ucet) => {
  const parsed = updateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (parsed.data.status) {
    update.status = parsed.data.status
    // U schválení a zamítnutí je vidět, kdo rozhodl — banka je společná.
    update.reviewedBy = ucet.userId
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
    // Text pro hledání se přepočítá spolu s obsahem — jinak by se upravená
    // otázka dala v bance najít jen podle svého původního znění.
    update.searchText = searchTextFor(parsed.data.question)
  }

  await db
    .update(questions)
    .set(update)
    .where(and(skola(ucet, questions), inArray(questions.id, [parsed.data.id])))
  return Response.json({ ok: true })
  }, { zapis: true })
}

/**
 * Hromadné schválení nebo zamítnutí — buď výčtem otázek, nebo celým tématem.
 * U tématu se vracejí id skutečně změněných otázek, aby šlo akci vzít zpět
 * přesně: co bylo schválené už předtím, se zpátky na koncept měnit nesmí.
 */
export async function PUT(request: Request) {
  return sRozsahem(async (ucet) => {
  const body = await request.json()

  if (body && typeof body === 'object' && 'topicId' in body) {
    const parsed = bulkTopicSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
    }
    const ids = await setStatusForTopic(ucet, parsed.data.topicId, parsed.data.from, parsed.data.status)
    return Response.json({ updated: ids.length, ids })
  }

  const parsed = bulkSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }
  await db
    .update(questions)
    .set({
      status: parsed.data.status,
      reviewedBy: ucet.userId,
      reviewedAt: new Date().toISOString(),
    })
    .where(and(skola(ucet, questions), inArray(questions.id, parsed.data.ids)))
  return Response.json({ updated: parsed.data.ids.length })
  }, { zapis: true })
}

export async function DELETE(request: Request) {
  return sRozsahem(async (ucet) => {
    const ids = new URL(request.url).searchParams.getAll('id')
    if (ids.length === 0) return Response.json({ error: 'Chybí id' }, { status: 400 })
    await deleteQuestionsWithAssets(ucet, ids)
    return Response.json({ deleted: ids.length })
  }, { zapis: true })
}
