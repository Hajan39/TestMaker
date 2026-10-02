import { z } from 'zod'
import { t } from '../i18n'
import { questionContentSchema, type Question, type QuestionContent } from './question'
import { parsePuzzleSnapshot, toPuzzleSnapshot, type Puzzle, type PuzzleContent } from './puzzle'
import type { Template } from './template'

/**
 * Test item — a test is not limited to a plain list of questions. The fifth
 * kind, `puzzle`, is a finished puzzle (word search, cryptogram): it is not a
 * question and has no place in the bank, but it can be put into a test.
 * `text` (short text, fun fact) and `table` (table to fill in) belong to
 * worksheets.
 */
export const TEST_ITEM_KINDS = ['question', 'heading', 'instruction', 'page_break', 'puzzle', 'text', 'table'] as const
export type TestItemKind = (typeof TEST_ITEM_KINDS)[number]

/**
 * Test or worksheet. A worksheet shares the editor, templates and printing
 * with a test, but nothing on it is graded and its tasks do not go into the
 * bank.
 */
export const testKindSchema = z.enum(['pisemka', 'pracovni_list'])
export type TestKind = z.infer<typeof testKindSchema>

/* ------------------------------------------------- worksheet items */

/** Short text, or a boxed fun fact. The text itself is in the `text` column. */
export const TEXT_ITEM_VARIANTS = ['text', 'fun_fact'] as const
export type TextItemVariant = (typeof TEXT_ITEM_VARIANTS)[number]

export const textItemContentSchema = z.object({ variant: z.enum(TEXT_ITEM_VARIANTS) })
export type TextItemContent = z.infer<typeof textItemContentSchema>

/** More columns do not fit an A4 width; more rows are no longer a fill-in table but copying. */
export const TABLE_MAX_COLUMNS = 6
export const TABLE_MAX_ROWS = 12

export const worksheetTableCellSchema = z.object({
  value: z.string(),
  /** Blank cell to fill in; `value` is then the correct answer for the key. */
  blank: z.boolean(),
})
export type WorksheetTableCell = z.infer<typeof worksheetTableCellSchema>

/**
 * Table shape without cross-field checks — this is what the model gets.
 * Cross-field checks (cells per row, at least one blank) do not carry over
 * into the JSON schema for the model, so they are verified in code via
 * `tableItemContentSchema`.
 */
export const tableItemShapeSchema = z.object({
  /** Optional caption above the table. */
  caption: z.string().optional(),
  header: z.array(z.string()).min(1).max(TABLE_MAX_COLUMNS),
  rows: z.array(z.array(worksheetTableCellSchema)).min(1).max(TABLE_MAX_ROWS),
})

export const tableItemContentSchema = tableItemShapeSchema.superRefine((table, ctx) => {
  if (table.rows.some((row) => row.length !== table.header.length)) {
    ctx.addIssue({ code: 'custom', message: t('core:worksheetTable.rowLength') })
  }
  if (!table.rows.some((row) => row.some((cell) => cell.blank))) {
    ctx.addIssue({ code: 'custom', message: t('core:worksheetTable.needsBlank') })
  }
})
export type TableItemContent = z.infer<typeof tableItemContentSchema>

/**
 * Item content from the database. Corrupted content returns `null` — the
 * item then shows as broken in the preview instead of the whole worksheet
 * crashing (pattern: `parseQuestionSnapshot`).
 */
export function parseItemContent(kind: 'text', raw: unknown): TextItemContent | null
export function parseItemContent(kind: 'table', raw: unknown): TableItemContent | null
export function parseItemContent(kind: 'text' | 'table', raw: unknown): TextItemContent | TableItemContent | null {
  const parsed = (kind === 'text' ? textItemContentSchema : tableItemContentSchema).safeParse(raw)
  return parsed.success ? parsed.data : null
}

/**
 * Worksheet brief as the teacher wrote it. Stored with the worksheet
 * (`tests.brief`) as JSON so that regenerating single items starts from the
 * same brief.
 */
export const worksheetBriefSchema = z.object({
  /** Name of the topic or free-form brief at creation time. */
  title: z.string(),
  instructions: z.string().default(''),
  ownText: z.string().default(''),
  /**
   * Only the supplied text (materials, own text) may be used. When off, the
   * model may add general knowledge, examples and made-up situations — such
   * items get the "ověř" flag.
   */
  onlyMaterials: z.boolean().default(true),
})
export type WorksheetBrief = z.infer<typeof worksheetBriefSchema>

/** Brief from the database; text that is not our JSON is taken as the instruction. */
export function parseWorksheetBrief(raw: string | null | undefined): WorksheetBrief | null {
  if (!raw) return null
  try {
    const parsed = worksheetBriefSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // Not JSON — taken as a plain instruction below.
  }
  return { title: '', instructions: raw, ownText: '', onlyMaterials: true }
}

export const testHeaderConfigSchema = z.object({
  school: z.string().default(''),
  subject: z.string().default(''),
  className: z.string().default(''),
  teacher: z.string().default(''),
  /** Date as text; empty = a line to fill in. */
  date: z.string().default(''),
  note: z.string().default(''),
})

export type TestHeaderConfig = z.infer<typeof testHeaderConfigSchema>

export interface TestItem {
  id: string
  testId: string
  order: number
  kind: TestItemKind
  /** Set for `kind === 'question'`. */
  questionId: string | null
  /** Set for `kind === 'puzzle'`. */
  puzzleId?: string | null
  /** Heading or instruction text. */
  text: string | null
  /** Points override for this question in this test. */
  pointsOverride: number | null
  /**
   * Answer line count override for this question in this test.
   * Empty (or missing in older data) = the question's own value applies.
   */
  linesOverride?: number | null
  /**
   * Frozen question content as JSON, as it was when the test was saved.
   * Missing only for tests created before snapshots were introduced.
   */
  questionSnapshot?: string | null
  /**
   * Frozen puzzle content as JSON — for the same reason as for questions: a
   * later edit of the puzzle must not change an already printed test or key.
   */
  puzzleSnapshot?: string | null
  /**
   * Content of a `text` (variant) or `table` (grid) item as stored in the
   * database. Read via `parseItemContent`, not directly.
   */
  content?: unknown
  /** "Check" flag: the content is not based on the materials. Not printed. */
  needsCheck?: boolean
}

/**
 * How many answer lines to print. The override in the test takes precedence
 * over what the model stored with the question — answer space belongs to the
 * test, not to the question.
 */
export function answerLines(
  question: { type: string; payload: unknown },
  linesOverride: number | null | undefined,
): number {
  if (linesOverride && linesOverride > 0) return linesOverride
  const payload = question.payload as { lines?: number }
  return typeof payload.lines === 'number' ? payload.lines : 1
}

/* ------------------------------------------------- question snapshot in a test */

/**
 * Question snapshot frozen when the question is added to a test. Same shape
 * as the question content (`questionContentSchema`) — a second definition of
 * the same thing would diverge sooner or later. Question metadata (id, topic,
 * status) does not belong in the snapshot: what matters is what the pupil has
 * on paper, not where it came from.
 *
 * Why at all: without a snapshot a finished test silently changes every time
 * the teacher edits the question in the bank — and the answer key then no
 * longer matches the printed test.
 */
export const questionSnapshotSchema = questionContentSchema

export type QuestionSnapshot = QuestionContent

/** Question content for a snapshot — zod drops metadata and anything extra. */
export function toQuestionSnapshot(question: QuestionContent): QuestionSnapshot {
  return questionSnapshotSchema.parse(question)
}

/**
 * Snapshot from stored JSON. A corrupted or invalid snapshot returns `null` —
 * the caller then uses the live question instead of the whole test falling
 * apart.
 */
export function parseQuestionSnapshot(raw: string | null | undefined): QuestionSnapshot | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = questionSnapshotSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** Snapshot to store in the database. */
export function serializeQuestionSnapshot(question: QuestionContent): string {
  return JSON.stringify(toQuestionSnapshot(question))
}

/** Stable form for comparison — key order in JSON does not matter. */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Does the live question differ from the snapshot? The UI uses this to note
 * on a test item that the question was edited since it was added.
 */
export function snapshotDiffersFromQuestion(
  snapshot: QuestionSnapshot,
  question: QuestionContent,
): boolean {
  return stableKey(snapshot) !== stableKey(toQuestionSnapshot(question))
}

export interface Test {
  id: string
  /** Who composed the test. Other people's tests are neither shown nor printed. */
  ownerId: string
  /** `soukrome` is visible only to the author, `skola` also to colleagues. */
  visibility: 'soukrome' | 'skola'
  kind: TestKind
  /** Topic the worksheet was made from; `null` for tests and free-form briefs. */
  topicId: string | null
  /** Worksheet brief (JSON per `worksheetBriefSchema`); `null` for tests. */
  brief: string | null
  title: string
  description: string | null
  /** Graded test — without it neither points nor the grade box are rendered. */
  graded: boolean
  templateId: string
  /** Class the test was made for. `null` for older tests and tests without a class. */
  gradeId: string | null
  header: TestHeaderConfig
  /** 1 = variant A only, 2 = A and B. */
  variants: 1 | 2
  showKey: boolean
  createdAt: string
  updatedAt: string
}

/** Test ready for rendering: items have their questions attached. */
export interface ResolvedTestItem extends TestItem {
  /**
   * Set for `kind === 'question'`. Comes from the snapshot; the live question
   * is used only where the snapshot is missing or corrupted.
   */
  question?: Question | null
  /** The live question in the bank differs from the snapshot — the test prints the snapshot. */
  questionEdited?: boolean
  /** The question is no longer in the bank; the test lives on from the snapshot. */
  questionMissing?: boolean
  /** Set for `kind === 'puzzle'`; comes from the snapshot. */
  puzzle?: PuzzleContent | null
  /** The puzzle is no longer in the library; the test lives on from the snapshot. */
  puzzleMissing?: boolean
  /** Set for `kind === 'table'`; `null` when the stored content is corrupted. */
  table?: TableItemContent | null
  /** Set for `kind === 'text'`; `null` when the stored content is corrupted. */
  textContent?: TextItemContent | null
}

/**
 * Puzzle of a test item: the snapshot takes precedence, the live puzzle is a
 * fallback when no snapshot was taken or it is corrupted. Same rule as for
 * questions — the paper should keep what was put into the test.
 */
export function resolveTestItemPuzzle(
  rawSnapshot: string | null | undefined,
  live: Puzzle | null,
): Pick<ResolvedTestItem, 'puzzle' | 'puzzleMissing'> {
  const snapshot = parsePuzzleSnapshot(rawSnapshot)
  if (snapshot) return { puzzle: snapshot, puzzleMissing: !live }
  if (!live) return { puzzle: null, puzzleMissing: true }
  // Metadata (id, topic, timestamps) does not belong to the item content; the schema drops it.
  return { puzzle: toPuzzleSnapshot(live), puzzleMissing: false }
}

/**
 * Question of a test item: the snapshot takes precedence, the live question
 * from the bank is only a fallback for older data and corrupted snapshots.
 * Metadata (id, topic, status) comes from the live question if it still
 * exists — it is not in the snapshot because it says nothing about the
 * printed test.
 */
export function resolveTestItemQuestion(
  rawSnapshot: string | null | undefined,
  live: Question | null,
  fallbackId: string,
): Pick<ResolvedTestItem, 'question' | 'questionEdited' | 'questionMissing'> {
  const snapshot = parseQuestionSnapshot(rawSnapshot)
  if (!snapshot) {
    // Without a usable snapshot the live question remains — nothing breaks,
    // such an item may just change when the question is edited.
    return { question: live, questionEdited: false, questionMissing: false }
  }
  const question = {
    ...snapshot,
    id: live?.id ?? fallbackId,
    topicId: live?.topicId ?? null,
    materialId: live?.materialId ?? null,
    source: live?.source ?? 'ai',
    status: live?.status ?? 'approved',
    createdAt: live?.createdAt ?? '',
  } as Question

  return {
    question,
    questionEdited: Boolean(live) && snapshotDiffersFromQuestion(snapshot, live as Question),
    questionMissing: !live,
  }
}

export interface RenderableTest {
  test: Test
  template: Template
  items: ResolvedTestItem[]
  /** 'A' | 'B' — variant B has a shuffled order. */
  variant: 'A' | 'B'
  /** Render the answer key instead of/after the test. */
  withKey: boolean
  /** The teacher's copy: the test itself with the correct answers written in. */
  filled?: boolean
  /** Data of images used in the test (assetId → data URL). */
  assets: Record<string, string>
}

/** Total points of the test. */
export function totalPoints(items: ResolvedTestItem[]): number {
  return items.reduce((sum, item) => {
    if (item.kind !== 'question' || !item.question) return sum
    return sum + (item.pointsOverride ?? item.question.points)
  }, 0)
}
