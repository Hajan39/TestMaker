import 'server-only'
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import { generatePuzzleWords } from '@testmaker/core/ai'
import {
  puzzleContentSchema,
  puzzleInstructions,
  serializePuzzleSnapshot,
  templateConfigSchema,
  toPuzzleSnapshot,
  type Puzzle,
  type PuzzleContent,
  type PuzzleKind,
  type RenderableTest,
  type ResolvedTestItem,
} from '@testmaker/core/schema'
import { db, grades, materials, puzzles, subjects, templates, topics } from '@/db'
import type { PuzzleRow } from '@/db'
import { skola, vlastni, type Scope } from '@/lib/uzivatel'
import { newId } from '@/lib/ids'

/**
 * Hlavolam je soukromý stejně jako písemka: vidí ho, upraví a vytiskne jen
 * ta, kdo ho vyrobila. Témata, ze kterých vzniká, jsou naopak společná.
 */

/** Řádek databáze na hlavolam podle schématu core. */
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

/** Seznam hlavolamů od nejnovějšího; volitelně jen k jednomu tématu. */
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
    .leftJoin(topics, eq(topics.id, puzzles.topicId))
    .where(and(vlastni(scope, puzzles), options.topicId ? eq(puzzles.topicId, options.topicId) : undefined))
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

/**
 * Témata, ze kterých má smysl hlavolam dělat — tedy ta s použitelným textem.
 * Bez materiálů nemá model z čeho slova vytáhnout a učitelka by vybírala
 * z celé knihovny prázdných témat.
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
    .where(and(skola(scope, topics), gt(topics.usableCharCount, 0)))
    .orderBy(asc(subjects.name), asc(grades.position), asc(topics.name))

  return rows.map((row) => ({
    id: row.id,
    label: [row.subjectName, row.gradeName, row.name].filter(Boolean).join(' · '),
  }))
}

export async function loadPuzzle(scope: Scope, id: string): Promise<Puzzle | null> {
  const [row] = await db
    .select()
    .from(puzzles)
    .where(and(vlastni(scope, puzzles), eq(puzzles.id, id)))
    .limit(1)
  return row ? toPuzzle(row) : null
}

/** Uloží nový hlavolam a vrátí ho i s metadaty. */
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
  if (!saved) throw new Error('Hlavolam se nepodařilo uložit')
  return saved
}

/** Přepíše hlavolam. Vrací `null`, když už v knihovně není. */
export async function updatePuzzle(
  scope: Scope,
  id: string,
  content: PuzzleContent,
  options: { topicId?: string | null } = {},
): Promise<Puzzle | null> {
  const [existing] = await db
    .select()
    .from(puzzles)
    .where(and(vlastni(scope, puzzles), eq(puzzles.id, id)))
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
    .where(and(vlastni(scope, puzzles), eq(puzzles.id, id)))
  return loadPuzzle(scope, id)
}

export async function deletePuzzle(scope: Scope, id: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: puzzles.id })
    .from(puzzles)
    .where(and(vlastni(scope, puzzles), eq(puzzles.id, id)))
    .limit(1)
  if (!existing) return false
  await db.delete(puzzles).where(and(vlastni(scope, puzzles), eq(puzzles.id, id)))
  return true
}

/**
 * Hlavolam jako samostatná písemka k vytištění: jediná položka druhu
 * `puzzle` v šabloně, kterou učitelka zná z testů. Tiskne se tak toutéž
 * cestou (`renderTestToBuffer`) jako písemka — druhý vykreslovač by se
 * dřív nebo později rozešel s prvním.
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
        .where(and(skola(scope, templates), eq(templates.id, options.templateId)))
        .limit(1)
    : await db
        .select()
        .from(templates)
        .where(skola(scope, templates))
        .orderBy(asc(templates.position), asc(templates.name))
        .limit(1)
  if (!templateRow) return null

  // Metadata (id, téma, časy) do obsahu nepatří — schéma je zahodí.
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
      title: puzzle.title,
      description: puzzleInstructions(puzzle),
      // Hlavolam se neznámkuje: políčko na body ani známku na něm nemá co dělat.
      graded: false,
      templateId: templateRow.id,
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
 * Slovní zásoba k tématu od modelu. Materiály se skládají stejně jako u
 * otázek (celá skupina, duplicity se vynechávají) — hlavolam vzniká z tématu,
 * ne z jednoho souboru.
 */
export async function suggestPuzzleWords(
  scope: Scope,
  topicId: string,
  options: {
    kind: PuzzleKind
    count: number
    avoid?: string[]
    signal?: AbortSignal
    /** Podvržené volání modelu pro testy; v aplikaci se nepředává. */
    generate?: typeof generatePuzzleWords
  },
): Promise<{ entries: { word: string; clue: string }[]; rejected: { word: string; reason: string }[]; models: string[] }> {
  const [meta] = await db
    .select({ topicName: topics.name, gradeName: grades.name, subjectName: subjects.name })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(skola(scope, topics), eq(topics.id, topicId)))
    .limit(1)
  if (!meta) throw new Error('Téma nenalezeno')

  const rows = await db
    .select({ fileName: materials.fileName, text: materials.text })
    .from(materials)
    .where(and(skola(scope, materials), eq(materials.topicId, topicId), isNull(materials.duplicateOfId)))
    .orderBy(asc(materials.fileName))

  const text = rows
    .map((row) => `=== ${row.fileName} ===\n${row.text}`)
    .join('\n\n')
    .trim()
  if (text.length < 200) {
    throw new Error('Materiály tématu obsahují příliš málo textu na vytažení slov')
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
    },
    { signal: options.signal },
  )
}
