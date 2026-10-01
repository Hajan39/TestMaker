import 'server-only'
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import { generatePuzzleWords, type PuzzleWordsResult } from '@testmaker/core/ai'
import { buildPuzzle, puzzleProblems, type PuzzleProblem } from '@testmaker/core/puzzle'
import {
  puzzleContentSchema,
  puzzleInstructions,
  serializePuzzleSnapshot,
  templateConfigSchema,
  toPuzzleSnapshot,
  type Puzzle,
  type PuzzleContent,
  type PuzzleEntry,
  type PuzzleKind,
  type RenderableTest,
  type ResolvedTestItem,
} from '@testmaker/core/schema'
import { t } from '@testmaker/core/i18n'
import { db, grades, materials, puzzleWordDrafts, puzzles, subjects, templates, topics } from '@/db'
import type { PuzzleRow } from '@/db'
import { callRecorder } from '@/lib/aiUsage'
import { inSchool, ownedBy, type Scope } from '@/lib/user'
import { newId } from '@/lib/ids'

/**
 * A puzzle is private just like a test: only its author sees, edits and
 * prints it. The topics it is made from are shared, on the other hand.
 */

/** A database row as a puzzle per the core schema. */
export function toPuzzle(row: PuzzleRow): Puzzle {
  const content = puzzleContentSchema.parse({
    kind: row.kind,
    title: row.title,
    instructions: row.instructions,
    entries: row.entries,
    payload: row.payload,
  })
  return { ...content, id: row.id, topicId: row.topicId, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

export interface PuzzleListItem {
  id: string
  kind: PuzzleKind
  title: string
  topicId: string | null
  topicName: string | null
  entryCount: number
  updatedAt: string
}

/** Puzzles from the newest; optionally for one topic only. */
export async function loadPuzzleList(
  scope: Scope,
  options: { topicId?: string } = {},
): Promise<PuzzleListItem[]> {
  const rows = await db
    .select({
      id: puzzles.id,
      kind: puzzles.kind,
      title: puzzles.title,
      topicId: puzzles.topicId,
      topicName: topics.name,
      entries: puzzles.entries,
      updatedAt: puzzles.updatedAt,
    })
    .from(puzzles)
    // Topic name only from the own school — a foreign topic is not revealed even by name.
    .leftJoin(topics, and(eq(topics.id, puzzles.topicId), inSchool(scope, topics)))
    .where(and(ownedBy(scope, puzzles), options.topicId ? eq(puzzles.topicId, options.topicId) : undefined))
    .orderBy(desc(puzzles.updatedAt))

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    topicId: row.topicId,
    topicName: row.topicName,
    entryCount: Array.isArray(row.entries) ? row.entries.length : 0,
    updatedAt: row.updatedAt,
  }))
}

export interface PuzzleTopic {
  id: string
  label: string
}

export async function loadPuzzleWordDraft(
  scope: Scope,
  topicId: string,
  kind: PuzzleKind,
): Promise<PuzzleEntry[]> {
  const [row] = await db
    .select({ entries: puzzleWordDrafts.entries })
    .from(puzzleWordDrafts)
    // Draft words are personal even for the administrator — otherwise they
    // would load someone else's draft and saving would create a second one.
    .where(
      and(
        inSchool(scope, puzzleWordDrafts),
        eq(puzzleWordDrafts.ownerId, scope.userId),
        eq(puzzleWordDrafts.topicId, topicId),
        eq(puzzleWordDrafts.kind, kind),
      ),
    )
    .limit(1)
  return row?.entries ?? []
}

export async function savePuzzleWordDraft(
  scope: Scope,
  topicId: string,
  kind: PuzzleKind,
  entries: PuzzleEntry[],
  model?: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insert(puzzleWordDrafts)
    .values({ id: newId(), schoolId: scope.schoolId, ownerId: scope.userId, topicId, kind, entries, model: model ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: [puzzleWordDrafts.schoolId, puzzleWordDrafts.ownerId, puzzleWordDrafts.topicId, puzzleWordDrafts.kind],
      set: { entries, model: model ?? null, updatedAt: now },
    })
}

/**
 * Topics worth making a puzzle from — those with usable text. Without
 * materials the model has nothing to extract words from and the teacher would
 * pick from a whole library of empty topics.
 */
export async function loadPuzzleTopics(scope: Scope): Promise<PuzzleTopic[]> {
  const rows = await db
    .select({
      id: topics.id,
      name: topics.name,
      gradeName: grades.name,
      subjectName: subjects.name,
    })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(inSchool(scope, topics), gt(topics.usableCharCount, 0)))
    .orderBy(asc(subjects.name), asc(grades.position), asc(topics.name))

  return rows.map((row) => ({
    id: row.id,
    label: [row.subjectName, row.gradeName, row.name].filter(Boolean).join(' · '),
  }))
}

/**
 * Does the topic belong to the signed-in person's school? A puzzle may link
 * only to an own topic; a foreign one looks non-existent, like a missing one.
 */
export async function topicExists(scope: Scope, topicId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(inSchool(scope, topics), eq(topics.id, topicId)))
    .limit(1)
  return Boolean(row)
}

/**
 * Puzzle problems that prevent printing or adding it to a test (a word did
 * not fit the grid, the cryptogram lacks a letter…). Computed by the same core
 * `buildPuzzle` that draws the preview and the paper.
 */
export function puzzleBlockingProblems(content: PuzzleContent): PuzzleProblem[] {
  return puzzleProblems(buildPuzzle(content))
}

/**
 * Zod errors as a sentence for the teacher. Describes the first problem so it
 * is clear which field to fix; technical details stay in `detail`.
 */
export function describePuzzleIssues(issues: readonly { path: readonly PropertyKey[] }[]): string {
  const issue = issues[0]
  if (!issue) return t('puzzles:errors.issues.generic')
  const path = issue.path.map(String)
  const field = path.at(-1)
  const inPuzzle = path[0] === 'puzzle' ? path.slice(1) : path
  if (inPuzzle[0] === 'entries' && inPuzzle.length === 1) {
    return t('puzzles:errors.issues.entries')
  }
  if (inPuzzle[0] === 'entries') {
    const row = Number(inPuzzle[1]) + 1
    if (field === 'word') return t('puzzles:errors.issues.word', { row })
    if (field === 'clue') return t('puzzles:errors.issues.clue', { row })
  }
  if (field === 'title') return t('puzzles:errors.issues.title')
  if (field === 'instructions') return t('puzzles:errors.issues.instructions')
  if (field === 'cols' || field === 'rows') return t('puzzles:errors.issues.grid')
  if (field === 'phrase') return t('puzzles:errors.issues.phrase')
  if (field === 'topicId') return t('puzzles:errors.issues.topicId')
  return t('puzzles:errors.issues.generic')
}

export async function loadPuzzle(scope: Scope, id: string): Promise<Puzzle | null> {
  const [row] = await db
    .select()
    .from(puzzles)
    .where(and(ownedBy(scope, puzzles), eq(puzzles.id, id)))
    .limit(1)
  return row ? toPuzzle(row) : null
}

/** Saves a new puzzle and returns it with its metadata. */
export async function insertPuzzle(
  scope: Scope,
  content: PuzzleContent,
  options: { topicId: string | null; model?: string | null },
): Promise<Puzzle> {
  const id = newId()
  await db.insert(puzzles).values({
    id,
    schoolId: scope.schoolId,
    ownerId: scope.userId,
    topicId: options.topicId,
    kind: content.kind,
    title: content.title,
    instructions: content.instructions,
    entries: content.entries,
    payload: content.payload,
    model: options.model ?? null,
  })
  const saved = await loadPuzzle(scope, id)
  if (!saved) throw new Error(t('puzzles:errors.saveFailed'))
  return saved
}

/** Overwrites a puzzle. Returns `null` when it is no longer in the library. */
export async function updatePuzzle(
  scope: Scope,
  id: string,
  content: PuzzleContent,
  options: { topicId?: string | null } = {},
): Promise<Puzzle | null> {
  const [existing] = await db
    .select()
    .from(puzzles)
    .where(and(ownedBy(scope, puzzles), eq(puzzles.id, id)))
    .limit(1)
  if (!existing) return null

  await db
    .update(puzzles)
    .set({
      kind: content.kind,
      title: content.title,
      instructions: content.instructions,
      entries: content.entries,
      payload: content.payload,
      topicId: options.topicId !== undefined ? options.topicId : existing.topicId,
      updatedAt: new Date().toISOString(),
    })
    .where(and(ownedBy(scope, puzzles), eq(puzzles.id, id)))
  return loadPuzzle(scope, id)
}

export async function deletePuzzle(scope: Scope, id: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: puzzles.id })
    .from(puzzles)
    .where(and(ownedBy(scope, puzzles), eq(puzzles.id, id)))
    .limit(1)
  if (!existing) return false
  await db.delete(puzzles).where(and(ownedBy(scope, puzzles), eq(puzzles.id, id)))
  return true
}

/**
 * A puzzle as a standalone test to print: a single item of kind `puzzle` in
 * a template the teacher knows from tests. It prints along the same path
 * (`renderTestToBuffer`) as a test — a second renderer would sooner or later
 * drift from the first.
 */
export async function loadRenderablePuzzle(
  scope: Scope,
  id: string,
  options: { withKey: boolean; templateId?: string },
): Promise<RenderableTest | null> {
  const puzzle = await loadPuzzle(scope, id)
  if (!puzzle) return null

  const [templateRow] = options.templateId
    ? await db
        .select()
        .from(templates)
        .where(and(inSchool(scope, templates), eq(templates.id, options.templateId)))
        .limit(1)
    : await db
        .select()
        .from(templates)
        .where(inSchool(scope, templates))
        .orderBy(asc(templates.position), asc(templates.name))
        .limit(1)
  if (!templateRow) return null

  // Metadata (id, topic, timestamps) does not belong in the content — the schema drops it.
  const content = toPuzzleSnapshot(puzzle)
  const item: ResolvedTestItem = {
    id: `puzzle-${puzzle.id}`,
    testId: `puzzle-${puzzle.id}`,
    order: 0,
    kind: 'puzzle',
    questionId: null,
    puzzleId: puzzle.id,
    text: null,
    pointsOverride: null,
    puzzle: content,
    puzzleSnapshot: serializePuzzleSnapshot(content),
  }

  const now = new Date().toISOString()
  return {
    test: {
      id: `puzzle-${puzzle.id}`,
      ownerId: scope.userId,
      visibility: 'soukrome',
      kind: 'pisemka',
      topicId: null,
      brief: null,
      // The header carries the title and instructions; `TestDocument` then
      // does not repeat them for a puzzle (see `puzzleHeadShown`), so they print once.
      title: puzzle.title,
      description: puzzleInstructions(puzzle),
      // A puzzle is not graded: a points box or a grade has no place on it.
      graded: false,
      templateId: templateRow.id,
      gradeId: null,
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      variants: 1,
      showKey: options.withKey,
      createdAt: puzzle.createdAt || now,
      updatedAt: puzzle.updatedAt || now,
    },
    template: {
      id: templateRow.id,
      name: templateRow.name,
      description: templateRow.description,
      config: templateConfigSchema.parse(templateRow.config),
      builtIn: templateRow.builtIn,
    },
    items: [item],
    variant: 'A',
    withKey: options.withKey,
    assets: {},
  }
}

/**
 * Topic vocabulary from the model. Materials are assembled the same way as for
 * questions (the whole group, duplicates left out) — a puzzle is made from a
 * topic, not from a single file.
 */
export async function suggestPuzzleWords(
  scope: Scope,
  topicId: string,
  options: {
    kind: PuzzleKind
    count: number
    avoid?: string[]
    /** Cryptogram phrase — the model picks words with the needed letters by it. */
    phrase?: string
    /** Word search grid — the longest word is checked against it. */
    grid?: { cols: number; rows: number }
    signal?: AbortSignal
    /** Stubbed model call for tests; not passed in the app. */
    generate?: typeof generatePuzzleWords
  },
): Promise<PuzzleWordsResult> {
  const [meta] = await db
    .select({ topicName: topics.name, gradeName: grades.name, subjectName: subjects.name })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(inSchool(scope, topics), eq(topics.id, topicId)))
    .limit(1)
  if (!meta) throw new Error(t('puzzles:errors.topicNotFound'))

  const rows = await db
    .select({ fileName: materials.fileName, text: materials.text })
    .from(materials)
    .where(
      and(
        inSchool(scope, materials),
        eq(materials.topicId, topicId),
        isNull(materials.duplicateOfId),
        eq(materials.excluded, false),
      ),
    )
    .orderBy(asc(materials.fileName))

  const text = rows
    .map((row) => `=== ${row.fileName} ===\n${row.text}`)
    .join('\n\n')
    .trim()
  if (text.length < 200) {
    throw new Error(t('puzzles:errors.notEnoughText'))
  }

  const generate = options.generate ?? generatePuzzleWords
  return generate(
    {
      text,
      topicName: meta.topicName,
      subjectName: meta.subjectName,
      gradeName: meta.gradeName || null,
      count: options.count,
      kind: options.kind,
      avoid: options.avoid,
      phrase: options.phrase,
      grid: options.grid,
    },
    { signal: options.signal, onCall: callRecorder(scope, 'hlavolam') },
  )
}
