import 'server-only'
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import {
  parseItemContent,
  parseWorksheetBrief,
  type WorksheetBrief,
  resolveTestItemPuzzle,
  resolveTestItemQuestion,
  serializeQuestionSnapshot,
  serializePuzzleSnapshot,
  templateConfigSchema,
  type RenderableTest,
  type ResolvedTestItem,
  type Template,
  type Test,
  type TestKind,
} from '@testmaker/core/schema'
import {
  db,
  assets,
  grades,
  puzzles,
  questions,
  subjects,
  templates,
  testItems,
  tests,
  topics,
  type TestItemRow,
} from '@/db'
import {
  generateWorksheet,
  regenerateWorksheetItem,
  type WorksheetItemDraft,
  type WorksheetRequest,
  type WorksheetTarget,
} from '@testmaker/core/ai'
import { t } from '@testmaker/core/i18n'
import { inSchool, visibleTest, ownedBy, type Scope } from './user'
import { loadTopicSource } from './generation'
import { newId } from './ids'
import { callRecorder } from './aiUsage'
import { toQuestion } from './questions'
import { toPuzzle } from './puzzles'

/**
 * A test is private: its author sees it and, if she shares it (`visibility`),
 * so do colleagues at the school. Someone else's test therefore behaves as
 * missing — `null` instead of a refusal, so the response doesn't reveal it exists.
 */

export interface TestQuery {
  /** Searches the test title and description. */
  search?: string
  templateId?: string
  /** The grade the test came from — a filter in the test overview. */
  gradeId?: string
  /** Written tests or worksheets; written tests when omitted (Tests overview). */
  kind?: TestKind
}

/**
 * Conditions for the test list. Searching happens in the database, not the
 * browser — the list used to load in full with no limit and last year's test
 * could only be found by eye.
 *
 * Case is ignored because SQLite's `like` is case-insensitive for ASCII; for
 * accented letters it is not ("Řepa" won't find "řepa"). That is enough for
 * test titles the teacher types herself — the question bank has its own
 * `search_text` column with pre-folded text for this.
 *
 * Percent signs and underscores are `like` wildcards, so they are escaped;
 * otherwise "100 %" would match everything.
 */
export function testConditions(scope: Scope, query: TestQuery): SQL[] {
  const visible = visibleTest(scope, tests)
  const conditions: SQL[] = visible ? [visible] : []
  conditions.push(eq(tests.kind, query.kind ?? 'pisemka'))
  const needle = query.search?.trim()
  if (needle) {
    const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    const match = or(
      sql`${tests.title} like ${pattern} escape '\\'`,
      sql`coalesce(${tests.description}, '') like ${pattern} escape '\\'`,
    )
    if (match) conditions.push(match)
  }
  if (query.templateId) conditions.push(eq(tests.templateId, query.templateId))
  if (query.gradeId) conditions.push(eq(tests.gradeId, query.gradeId))
  return conditions
}

export interface TestGradeOption {
  id: string
  /** "Subject · grade", the same shape as elsewhere in the app. */
  label: string
}

/**
 * Grade options for the test overview filter: only grades with at least one
 * test visible to the signed-in user. A grade without tests would point the
 * filter at an empty list, so it is left out.
 */
export async function loadTestGradeOptions(scope: Scope, kind: TestKind = 'pisemka'): Promise<TestGradeOption[]> {
  const rows = await db
    .selectDistinct({ id: grades.id, subjectName: subjects.name, gradeName: grades.name })
    .from(tests)
    .innerJoin(grades, eq(grades.id, tests.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(visibleTest(scope, tests), eq(tests.kind, kind)))
    .orderBy(asc(subjects.position), asc(subjects.name), asc(grades.position), asc(grades.name))
  return rows.map((row) => ({ id: row.id, label: `${row.subjectName} · ${row.gradeName}` }))
}

export async function loadTemplates(scope: Scope): Promise<Template[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(inSchool(scope, templates))
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
    .where(and(eq(tests.id, testId), visibleTest(scope, tests)))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    ownerId: row.ownerId,
    visibility: row.visibility,
    kind: row.kind,
    topicId: row.topicId,
    brief: row.brief,
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

/** One copied test item — everything `createTestVariant` needs to adjust further. */
export interface CopiedTestItem {
  id: string
  kind: TestItemRow['kind']
  questionId: string | null
}

export interface CopyTestResult {
  id: string
  copiedFrom: string
  items: CopiedTestItem[]
}

/**
 * Copy of a finished test.
 *
 * The teacher wants to reuse last year's test, not overwrite it — hence a copy
 * rather than editing the original. **Frozen question snapshots** are copied
 * too: retaking them from the bank would give the copy today's wording instead
 * of what was printed back then, and the same key could no longer be made.
 *
 * A colleague's shared test can be copied too; the copy is then mine and
 * private. Returns `null` when the source test is not visible (foreign or
 * missing) — the caller decides whether that becomes a 404 or is silently
 * passed over.
 *
 * `title` overrides the default copy title (`"<title> (kopie)"`) — a test
 * version needs another one (`"<title> – lehčí"`), which can't be computed
 * before the source is loaded, so it is a function of the title, not a string.
 */
export async function copyTest(
  scope: Scope,
  sourceId: string,
  options: { title?: (sourceTitle: string) => string } = {},
): Promise<CopyTestResult | null> {
  const [source] = await db
    .select()
    .from(tests)
    .where(and(eq(tests.id, sourceId), visibleTest(scope, tests)))
    .limit(1)
  if (!source) return null

  const items = await db
    .select()
    .from(testItems)
    .where(and(inSchool(scope, testItems), eq(testItems.testId, sourceId)))
    .orderBy(asc(testItems.position))

  const id = newId()
  const now = new Date().toISOString()
  await db.insert(tests).values({
    id,
    schoolId: scope.schoolId,
    ownerId: scope.userId,
    visibility: 'soukrome',
    // A worksheet copy stays a worksheet with its brief — otherwise it would show among tests.
    kind: source.kind,
    topicId: source.topicId,
    brief: source.brief,
    title: options.title ? options.title(source.title) : t('tests:copyTitle', { title: source.title }),
    description: source.description,
    graded: source.graded,
    templateId: source.templateId,
    // The source's grade was already checked against the school when it was
    // saved; the copy takes it unchanged like the other fields.
    gradeId: source.gradeId,
    header: source.header,
    variants: source.variants,
    showKey: source.showKey,
    createdAt: now,
    updatedAt: now,
  })

  const newItems = items.map((item) => ({
    id: newId(),
    schoolId: scope.schoolId,
    testId: id,
    position: item.position,
    kind: item.kind,
    questionId: item.questionId,
    text: item.text,
    pointsOverride: item.pointsOverride,
    linesOverride: item.linesOverride,
    // The snapshot is taken as is — the copy must look like the original even
    // if the bank question has since changed or disappeared.
    questionSnapshot: item.questionSnapshot,
    puzzleId: item.puzzleId,
    puzzleSnapshot: item.puzzleSnapshot,
    content: item.content,
    needsCheck: item.needsCheck,
  }))
  if (newItems.length > 0) await db.insert(testItems).values(newItems)

  return {
    id,
    copiedFrom: sourceId,
    items: newItems.map((item) => ({ id: item.id, kind: item.kind, questionId: item.questionId })),
  }
}

/**
 * Checks `gradeId` against the caller's school — a foreign or missing grade is
 * silently stored as `null`, so the response doesn't reveal that the grade
 * exists (in another school).
 */
export async function resolveGradeId(scope: Scope, gradeId: string | null): Promise<string | null> {
  if (!gradeId) return null
  const [row] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.id, gradeId), inSchool(scope, grades)))
    .limit(1)
  return row ? row.id : null
}

/**
 * Worksheet topic checked against the school, with the grade the worksheet
 * takes from it. A foreign or deleted topic returns `null`.
 */
export async function resolveTopic(
  scope: Scope,
  topicId: string | null,
): Promise<{ id: string; gradeId: string } | null> {
  if (!topicId) return null
  const [row] = await db
    .select({ id: topics.id, gradeId: topics.gradeId })
    .from(topics)
    .where(and(eq(topics.id, topicId), inSchool(scope, topics)))
    .limit(1)
  return row ?? null
}

/**
 * Question snapshots for a test being saved. Always made on the server from
 * the current bank — if the browser sent them, test content could be forged.
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
    .where(and(inSchool(scope, questions), inArray(questions.id, ids)))
  const snapshots = new Map<string, string>()
  for (const row of rows) {
    try {
      snapshots.set(row.id, serializeQuestionSnapshot(toQuestion(row)))
    } catch {
      // A question failing the schema (typically older data) is just not
      // frozen — saving the test must not be refused for it, and rendering
      // falls back to the live question.
    }
  }
  return snapshots
}

/**
 * Puzzle snapshots for a test being saved — same reason as for questions: what
 * went into a test must not change through later edits in the library.
 */
export async function buildPuzzleSnapshots(
  scope: Scope,
  puzzleIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(puzzleIds)]
  if (ids.length === 0) return new Map()

  // Only an own puzzle can be frozen: without this, guessing a foreign id would
  // be enough to have it in one's own test and PDF.
  const rows = await db
    .select()
    .from(puzzles)
    .where(and(ownedBy(scope, puzzles), inArray(puzzles.id, ids)))
  const snapshots = new Map<string, string>()
  for (const row of rows) {
    try {
      // `serializePuzzleSnapshot` reads the content through the schema, so
      // metadata (id, topic, timestamps) don't get into the snapshot.
      snapshots.set(row.id, serializePuzzleSnapshot(toPuzzle(row)))
    } catch {
      // A puzzle failing the schema is not frozen — saving is not refused for
      // it, and rendering falls back to the live one.
    }
  }
  return snapshots
}

/**
 * Test items with their questions, in order. The question comes from the
 * snapshot taken when the test was saved; the live bank question is used only
 * where the snapshot is missing (older tests) or broken.
 */
export async function loadTestItems(
  scope: Scope,
  testId: string,
  options: { ownerId?: string } = {},
): Promise<ResolvedTestItem[]> {
  // Items are read through the test itself, not just by `testId`: whoever may
  // not see it doesn't get its content either, even with a guessed id.
  const rows = (
    await db
      .select({ item: testItems })
      .from(testItems)
      .innerJoin(tests, eq(tests.id, testItems.testId))
      .where(and(eq(testItems.testId, testId), visibleTest(scope, tests)))
      .orderBy(asc(testItems.position))
  ).map((row) => row.item)

  // The fallback for a missing snapshot comes from the whole school for
  // questions (the bank is shared), but only from the test owner for puzzles:
  // a shared test would otherwise show a puzzle as its author has since edited it.
  const testOwner = options.ownerId ?? scope.userId

  const questionIds = rows.map((row) => row.questionId).filter((id): id is string => Boolean(id))
  const questionRows =
    questionIds.length > 0
      ? await db
          .select()
          .from(questions)
          .where(and(inSchool(scope, questions), inArray(questions.id, questionIds)))
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
              inSchool(scope, puzzles),
              eq(puzzles.ownerId, testOwner),
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
      content: row.content,
      needsCheck: row.needsCheck,
      // Broken content gives `null` — the item shows as broken, the worksheet lives on.
      ...(row.kind === 'table' ? { table: parseItemContent('table', row.content) } : {}),
      ...(row.kind === 'text' ? { textContent: parseItemContent('text', row.content) } : {}),
      ...resolveTestItemQuestion(row.questionSnapshot, live, row.id),
      ...(row.kind === 'puzzle' ? resolveTestItemPuzzle(row.puzzleSnapshot, livePuzzle) : {}),
    }
  })
}

/** Images used in the test as data URLs — react-pdf embeds them directly. */
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
    .where(and(inSchool(scope, assets), inArray(assets.id, [...ids])))
  return Object.fromEntries(
    rows.map((row) => [row.id, `data:${row.mimeType};base64,${Buffer.from(row.data).toString('base64')}`]),
  )
}

/**
 * Which visible tests already contain the questions — for the "V testu: …"
 * label and the "Jen nepoužité v testu" filter on the topic question card.
 *
 * A colleague's private test must not reveal the question (review point 1 in
 * the plan), so tests are read via `visibleTest`, not mere school membership.
 * A test is listed once per question even if the question appears in it
 * several times (a warm-up, then again in another part).
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
    .where(and(inArray(testItems.questionId, ids), visibleTest(scope, tests)))
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

/** Everything needed to render a test to PDF. */
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
    .where(and(inSchool(scope, templates), eq(templates.id, test.templateId)))
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

/* ------------------------------------------------------- worksheets */

/** What a worksheet is made from: a library topic or a free-form brief. */
export type WorksheetSource = { topicId: string } | { title: string; gradeId: string | null }

/**
 * Model request built from a topic (materials without duplicates and skipped
 * ones) or from a free-form brief. A foreign or deleted topic returns `null`;
 * a foreign grade of a free-form brief is silently dropped.
 */
export async function loadWorksheetRequest(
  scope: Scope,
  source: WorksheetSource,
  brief: { instructions: string; ownText: string },
): Promise<{ request: WorksheetRequest; topicId: string | null; gradeId: string | null } | null> {
  if ('topicId' in source) {
    const topic = await resolveTopic(scope, source.topicId)
    const loaded = topic ? await loadTopicSource(scope, topic.id) : null
    if (!topic || !loaded) return null
    return {
      request: {
        title: loaded.topicName,
        subjectName: loaded.subjectName,
        gradeName: loaded.gradeName || null,
        materials: loaded.text,
        ...brief,
      },
      topicId: topic.id,
      gradeId: topic.gradeId,
    }
  }

  const gradeId = await resolveGradeId(scope, source.gradeId)
  const [grade] = gradeId
    ? await db
        .select({ gradeName: grades.name, subjectName: subjects.name })
        .from(grades)
        .innerJoin(subjects, eq(subjects.id, grades.subjectId))
        .where(and(eq(grades.id, gradeId), inSchool(scope, grades)))
        .limit(1)
    : []
  return {
    request: {
      title: source.title,
      subjectName: grade?.subjectName ?? null,
      gradeName: grade?.gradeName ?? null,
      materials: '',
      ...brief,
    },
    topicId: null,
    gradeId,
  }
}

/** A model item as a `test_items` row. */
function worksheetItemRow(item: WorksheetItemDraft) {
  const base = { text: null, content: null, questionSnapshot: null, needsCheck: item.needsCheck }
  switch (item.kind) {
    case 'heading':
    case 'instruction':
      return { ...base, text: item.text }
    case 'text':
      return { ...base, text: item.text, content: item.content }
    case 'table':
      return { ...base, content: item.content }
    case 'question':
      return { ...base, questionSnapshot: serializeQuestionSnapshot(item.question) }
  }
}

/**
 * Generates a worksheet and saves it with its items in one write (`db.batch`),
 * so an error never leaves it half-saved. Tasks only go into item snapshots,
 * never into the bank. Returns `null` when the topic is not in the library.
 */
export async function createGeneratedWorksheet(
  scope: Scope,
  input: { source: WorksheetSource; instructions: string; ownText: string },
  options: { signal?: AbortSignal } = {},
): Promise<{ id: string; dropped: number; models: string[] } | null> {
  const loaded = await loadWorksheetRequest(scope, input.source, input)
  if (!loaded) return null
  const [template] = await loadTemplates(scope)
  if (!template) throw new Error(t('tests:api.schoolHasNoTemplate'))

  const result = await generateWorksheet(loaded.request, { signal: options.signal, onCall: callRecorder(scope, 'list') })

  const id = newId()
  const brief: WorksheetBrief = {
    title: loaded.request.title,
    instructions: input.instructions,
    ownText: input.ownText,
  }
  await db.batch([
    db.insert(tests).values({
      id,
      schoolId: scope.schoolId,
      ownerId: scope.userId,
      kind: 'pracovni_list',
      title: result.title,
      topicId: loaded.topicId,
      gradeId: loaded.gradeId,
      brief: JSON.stringify(brief),
      graded: false,
      templateId: template.id,
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
    }),
    db.insert(testItems).values(
      result.items.map((item, position) => ({
        id: newId(),
        schoolId: scope.schoolId,
        testId: id,
        position,
        kind: item.kind,
        ...worksheetItemRow(item),
      })),
    ),
  ])
  return { id, dropped: result.dropped, models: result.models }
}

/**
 * A new version of one item of an own worksheet — from the same brief and
 * topic materials. A foreign worksheet or a written test returns `null`.
 * Nothing is saved: the editor swaps the item and it is saved with the worksheet.
 */
export async function regenerateWorksheetPart(
  scope: Scope,
  testId: string,
  target: WorksheetTarget,
  existing: string[],
  options: { signal?: AbortSignal } = {},
): Promise<WorksheetItemDraft | null> {
  const [row] = await db
    .select({ title: tests.title, topicId: tests.topicId, gradeId: tests.gradeId, brief: tests.brief })
    .from(tests)
    .where(and(eq(tests.id, testId), ownedBy(scope, tests), eq(tests.kind, 'pracovni_list')))
    .limit(1)
  if (!row) return null
  const brief = parseWorksheetBrief(row.brief) ?? { title: '', instructions: '', ownText: '' }
  const title = brief.title || row.title
  // A deleted topic doesn't take the worksheet along (`topic_id` is cleared) —
  // it is then regenerated as a free-form brief from title and grade.
  const loaded =
    (row.topicId ? await loadWorksheetRequest(scope, { topicId: row.topicId }, brief) : null) ??
    (await loadWorksheetRequest(scope, { title, gradeId: row.gradeId }, brief))
  return regenerateWorksheetItem(loaded!.request, target, existing, {
    signal: options.signal,
    onCall: callRecorder(scope, 'list'),
  })
}
