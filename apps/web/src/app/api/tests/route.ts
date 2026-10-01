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
import { t } from '@testmaker/core/i18n'
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
import { inSchool, withScope, ownedBy, type SignedInUser } from '@/lib/user'

export const runtime = 'nodejs'

const itemSchema = z.object({
  /**
   * Id of an already saved item when editing. Keeps a re-save from dropping
   * the frozen content of a question that has since vanished from the bank —
   * there is nothing left to retake the snapshot from.
   */
  id: z.string().nullable().default(null),
  kind: z.enum(TEST_ITEM_KINDS),
  questionId: z.string().nullable().default(null),
  /** Set on items of kind `puzzle` — a puzzle included in the test. */
  puzzleId: z.string().nullable().default(null),
  text: z.string().nullable().default(null),
  pointsOverride: z.number().nullable().default(null),
  /** Number of answer lines for this test only; empty = per the question. */
  linesOverride: z.number().int().min(1).max(30).nullable().default(null),
  /** Content of a `text` item (variant) or `table` item (grid); validated by the core schema. */
  content: z.unknown().optional(),
  /** The "ověř" (verify) flag on a worksheet item. */
  needsCheck: z.boolean().default(false),
  /**
   * Content of a worksheet task. Worksheet tasks are not in the bank, so the
   * client sends the snapshot; for a written test the field is ignored and the
   * snapshot comes from the bank.
   */
  question: questionContentSchema.nullable().default(null),
})

const testSchema = z.object({
  title: z.string().min(1).max(200),
  /** Sharing with colleagues; private by default. */
  visibility: z.enum(['soukrome', 'skola']).default('soukrome'),
  description: z.string().max(1000).nullable().default(null),
  graded: z.boolean().default(true),
  templateId: z.string().min(1),
  /** The grade the test came from; checked against the school on save. */
  gradeId: z.string().min(1).nullable().default(null),
  header: testHeaderConfigSchema,
  variants: z.union([z.literal(1), z.literal(2)]).default(1),
  showKey: z.boolean().default(true),
  items: z.array(itemSchema).default([]),
  /** Written test or worksheet. Set only on creation. */
  kind: testKindSchema.default('pisemka'),
  /** Worksheet topic; checked against the school. Set only on creation. */
  topicId: z.string().min(1).nullable().default(null),
  /** Worksheet brief (JSON per `worksheetBriefSchema`). Set only on creation. */
  brief: z.string().max(40_000).nullable().default(null),
})

type Item = z.infer<typeof itemSchema>

/**
 * Rejected request body. The editor checks title and items itself, so this is
 * more likely a stale page or a missing template than a typo.
 */
const invalidTest = () => t('tests:api.invalidTest')

/**
 * Item content checked before anything is written — a rejected worksheet must
 * not stay half-saved in the database.
 */
function checkItems(kind: TestKind, items: Item[]): Response | null {
  for (const item of items) {
    if (item.kind === 'text' && !parseItemContent('text', item.content)) {
      return Response.json({ error: t('worksheets:api.invalidTextVariant') }, { status: 400 })
    }
    if (item.kind === 'table' && !parseItemContent('table', item.content)) {
      return Response.json(
        { error: t('worksheets:api.invalidTable') },
        { status: 400 },
      )
    }
    if (kind === 'pracovni_list' && item.kind === 'question' && !item.questionId && !item.question) {
      return Response.json({ error: t('worksheets:api.emptyTask') }, { status: 400 })
    }
  }
  return null
}

/**
 * Test list. Optionally narrowed by searching title and description (`q`),
 * template (`templateId`) and grade (`gradeId`) — tests pile up every year and
 * scanning them by eye stopped being enough.
 */
export async function GET(request: Request) {
  return withScope(async (account) => {
  const params = new URL(request.url).searchParams
  const conditions = testConditions(account, {
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
      /** Own or shared by a colleague — the list must tell them apart. */
      mine: sql<boolean>`${tests.ownerId} = ${account.userId}`,
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

/** Response to `?copyOf=`: a test copy from `lib/tests.ts`, or 404 when the source is not visible. */
async function copyTestResponse(account: SignedInUser, sourceId: string): Promise<Response> {
  const result = await copyTest(account, sourceId)
  if (!result) return Response.json({ error: t('tests:api.testNotFoundShort') }, { status: 404 })
  return Response.json({ id: result.id, copiedFrom: result.copiedFrom, items: result.items.length })
}

/** Creates a test with its items; with `?copyOf=<id>` copies an existing one. */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
      const copyOf = new URL(request.url).searchParams.get('copyOf')
      // A copy is recognised by the URL and has no body — so the body is only
      // read here, after the branch.
      if (copyOf) return copyTestResponse(account, copyOf)

      const parsed = testSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json({ error: invalidTest(), detail: parsed.error.issues }, { status: 400 })
      }
      const id = newId()
      const { items, kind, topicId: topicInput, brief, ...test } = parsed.data
      const invalid = checkItems(kind, items)
      if (invalid) return invalid

      const worksheet = kind === 'pracovni_list'
      // Topic and brief belong only to worksheets; a topic worksheet takes its grade from the topic.
      const topic = worksheet ? await resolveTopic(account, topicInput) : null
      const gradeId = (await resolveGradeId(account, test.gradeId)) ?? topic?.gradeId ?? null

      const rows = await itemRows(account, id, kind, items)
      if (rows instanceof Response) return rows

      // Test and items in one batch — otherwise a failed insert would leave an
      // empty test in the overview.
      await db.batch([
        db.insert(tests).values({
          id,
          schoolId: account.schoolId,
          ownerId: account.userId,
          ...test,
          kind,
          topicId: topic?.id ?? null,
          brief: worksheet ? brief : null,
          // Nothing on a worksheet is graded — regardless of what the client sends.
          graded: worksheet ? false : test.graded,
          gradeId,
        }),
        ...(rows.length > 0 ? [db.insert(testItems).values(rows)] : []),
      ])

      return Response.json({ id })
    },
    { write: true },
  )
}

/** Overwrites the test and its whole item list. */
export async function PUT(request: Request) {
  return withScope(
    async (account) => {
  // `gradeId` on PUT has no default unlike POST: a missing field means "keep
  // the grade" (an older client that never sends it), while an explicit `null`
  // means "unlink the grade". If the default filled `null` for a missing
  // field, the first save from an editor that doesn't send gradeId would
  // silently clear the test's grade.
  // Kind, topic and brief don't change on edit — the editor doesn't send them
  // and schema defaults would otherwise silently clear them.
  const schema = testSchema.omit({ kind: true, topicId: true, brief: true }).extend({
    id: z.string().min(1),
    gradeId: z.string().min(1).nullable().optional(),
  })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: invalidTest(), detail: parsed.error.issues }, { status: 400 })
  }
  const { id, items, gradeId: gradeIdInput, ...test } = parsed.data
  const gradeId = gradeIdInput === undefined ? undefined : await resolveGradeId(account, gradeIdInput)

  // Only the owner may edit: a shared test can be read and printed, not
  // overwritten.
  const [original] = await db
    .select({ kind: tests.kind })
    .from(tests)
    .where(and(eq(tests.id, id), ownedBy(account, tests)))
    .limit(1)
  if (!original) return Response.json({ error: t('tests:api.testNotFoundShort') }, { status: 404 })
  const invalid = checkItems(original.kind, items)
  if (invalid) return invalid

  // Snapshots of vanished questions must be loaded before the old items are deleted.
  const existing = await db
    .select({
      id: testItems.id,
      questionSnapshot: testItems.questionSnapshot,
      puzzleSnapshot: testItems.puzzleSnapshot,
    })
    .from(testItems)
    .where(and(inSchool(account, testItems), eq(testItems.testId, id)))
  const keptSnapshots = new Map(
    existing.filter((row) => row.questionSnapshot).map((row) => [row.id, row.questionSnapshot as string]),
  )
  const keptPuzzleSnapshots = new Map(
    existing.filter((row) => row.puzzleSnapshot).map((row) => [row.id, row.puzzleSnapshot as string]),
  )

  const rows = await itemRows(account, id, original.kind, items, {
    ids: new Set(existing.map((row) => row.id)),
    snapshots: keptSnapshots,
    puzzleSnapshots: keptPuzzleSnapshots,
  })
  if (rows instanceof Response) return rows

  // Update, delete old and insert new items at once: if the insert failed,
  // the test must not be left without items.
  await db.batch([
    db
      .update(tests)
      .set({
        ...test,
        graded: original.kind === 'pracovni_list' ? false : test.graded,
        // `gradeId` goes into `.set()` only when the body carried it — otherwise
        // an explicit `undefined` in the `.set()` object would clear the grade.
        ...(gradeId !== undefined ? { gradeId } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tests.id, id), ownedBy(account, tests))),
    db.delete(testItems).where(and(inSchool(account, testItems), eq(testItems.testId, id))),
    ...(rows.length > 0 ? [db.insert(testItems).values(rows)] : []),
  ])

  // Item ids are returned so the next save from the editor links to the same
  // items and their frozen snapshots.
  return Response.json({ id, itemIds: rows.map((row) => row.id) })
    },
    { write: true },
  )
}

export async function DELETE(request: Request) {
  return withScope(
    async (account) => {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return Response.json({ error: t('tests:api.missingId') }, { status: 400 })
      const deleted = await db
        .delete(tests)
        .where(and(eq(tests.id, id), ownedBy(account, tests)))
        .returning({ id: tests.id })
      if (deleted.length === 0) return Response.json({ error: t('tests:api.testNotFoundShort') }, { status: 404 })
      return Response.json({ ok: true })
    },
    { write: true },
  )
}

/** What the test already had: item ids and their frozen snapshots. */
interface KeptItems {
  ids: Set<string>
  snapshots: Map<string, string>
  puzzleSnapshots: Map<string, string>
}

/**
 * Prepares test item rows for insertion. Returns a response when something is
 * rejected — the caller writes, so everything goes in one batch.
 */
async function itemRows(
  account: SignedInUser,
  testId: string,
  kind: TestKind,
  items: Item[],
  kept: KeptItems = { ids: new Set(), snapshots: new Map(), puzzleSnapshots: new Map() },
): Promise<Response | (typeof testItems.$inferInsert & { id: string })[]> {
  if (items.length === 0) return []
  const keptSnapshots = kept.snapshots
  const keptPuzzleSnapshots = kept.puzzleSnapshots

  // The snapshot is taken here on the server from the current bank. The client
  // doesn't send it — otherwise anything could be slipped into a finished test.
  const snapshots = await buildQuestionSnapshots(
    account,
    items
      .filter((item) => item.kind === 'question')
      .map((item) => item.questionId)
      .filter((id): id is string => Boolean(id)),
  )

  // Same for puzzles: what was added to the test keeps a snapshot. Only an
  // own puzzle can be frozen — a foreign one can't get in even by a guessed id.
  const givenPuzzles = items
    .filter((item) => item.kind === 'puzzle')
    .map((item) => item.puzzleId)
    .filter((id): id is string => Boolean(id))
  const puzzleSnapshots = await buildPuzzleSnapshots(account, givenPuzzles)
  const foreign = givenPuzzles.filter(
    (id) => !puzzleSnapshots.has(id) && !keptPuzzleSnapshots.has(id),
  )
  if (foreign.length > 0) {
    return Response.json(
      { error: t('tests:api.foreignPuzzle') },
      { status: 403 },
    )
  }

  // An item already in the test keeps its id — only then can the editor link
  // to it and its frozen snapshot on the next save.
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
        schoolId: account.schoolId,
        testId,
        position: index,
        kind: item.kind,
        questionId,
        text: item.kind === 'question' || item.kind === 'puzzle' || item.kind === 'table' ? null : item.text,
        // Content passed `checkItems`; it is stored in the schema's shape.
        content:
          item.kind === 'text'
            ? parseItemContent('text', item.content)
            : item.kind === 'table'
              ? parseItemContent('table', item.content)
              : null,
        needsCheck: item.needsCheck,
        pointsOverride: item.pointsOverride,
        linesOverride: item.kind === 'question' ? item.linesOverride : null,
        // The snapshot is taken once, when the question is added to the test. An
        // item already in the test keeps the original — otherwise re-saving
        // (say, to fix the title) would overwrite an already printed test with
        // the current question wording, which freezing exists to prevent.
        //
        // A worksheet task is not in the bank: the teacher edits its content
        // right in the worksheet and the client sends the snapshot, so it wins
        // even over a previously saved snapshot.
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
