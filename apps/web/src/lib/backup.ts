/**
 * Shared base for both ways of moving the library elsewhere:
 *
 *   1. `scripts/push-remote.ts` — from the computer straight to Turso (database to database).
 *   2. `/api/export` — backup into a single JSON file and restore from it.
 *
 * Both read and write the same tables, in the same order and the same way
 * (`insert … on conflict(id) do update`), so both paths behave alike and can
 * be repeated. Nothing is ever deleted — merging is always by `id`.
 *
 * `@/db` deliberately appears nowhere here: this module is also used by a
 * script run via `tsx`, where the `@/` alias does not resolve, and above all
 * it must be able to reach any database, not only the one the app runs on.
 */
import { t } from '@testmaker/core/i18n'
import { and, asc, eq, getTableColumns, gt, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '../db/schema'

/** The database being worked on — the app and the script each pass their own. */
export type BackupDb = LibSQLDatabase<typeof schema>

/** One table row as it travels in JSON. */
export type Row = Record<string, unknown>

/**
 * Tables in the order they may be written: whatever is referenced must
 * already be in the target. The generation queue (`generation_jobs`) is not
 * transferred — it is one computer's working state, not library content, and
 * on the other side it would only leave records of runs that never happened
 * there. Regeneration feedback (`question_feedback`) is not transferred for
 * the same reason — it is telemetry for the "AI quality" overview, not library
 * content, and after a restore it would point at different (new) question ids.
 */
/**
 * Scope of backup and restore: always one school. Filtering by teacher makes
 * no sense — a partial file would leave questions without topics after a
 * restore. Restore also does not trust the file: it rewrites the school and
 * owners by who restores (see `writeRows`), otherwise an uploaded file could
 * write rows into another school.
 */
export interface BackupScope {
  schoolId: string
  /** Who gets content whose original owner does not exist in the target. */
  userId: string
}

export const TABLES = {
  subjects: schema.subjects,
  grades: schema.grades,
  topics: schema.topics,
  materials: schema.materials,
  assets: schema.assets,
  questions: schema.questions,
  puzzles: schema.puzzles,
  templates: schema.templates,
  prompt_rules: schema.promptRules,
  tests: schema.tests,
  test_items: schema.testItems,
} as const

export type TableName = keyof typeof TABLES

/**
 * A table without its concrete shape — otherwise a shared query over all
 * tables cannot be written. Each has an `id` primary key and that is the only
 * column referenced by name here.
 */
type Table = SQLiteTable & { id: AnySQLiteColumn }

/** Table by name, in a form that can be worked with generically. */
function tableOf(name: TableName): Table {
  return TABLES[name] as unknown as Table
}

/** Write order. `Object.keys` would degrade the type to `string[]`. */
export const TABLE_ORDER = Object.keys(TABLES) as TableName[]

/** Format marker in the backup file — so uploading something else is detected. */
export const FORMAT = 'testmaker-zaloha'
export const VERSION = 1

/** How many rows go into one `insert`. */
export const BATCH_SIZE = 200

/**
 * Cap on one batch's size. Materials carry full texts; two hundred long PDFs
 * in one statement is a needlessly big bite for the Turso connection.
 */
const MAX_BATCH_BYTES = 1_000_000

export function isTableName(name: string): name is TableName {
  return Object.prototype.hasOwnProperty.call(TABLES, name)
}

/** Table columns: JavaScript key → database name. */
function columns(name: TableName): Record<string, { name: string; columnType: string }> {
  return getTableColumns(tableOf(name)) as never
}

/** Columns holding binary content (today only `assets.data`). */
function binaryColumns(name: TableName): string[] {
  return Object.entries(columns(name))
    .filter(([, column]) => column.columnType === 'SQLiteBlobBuffer')
    .map(([key]) => key)
}

/**
 * A database row into a form JSON can carry. The only thing JSON cannot hold
 * is binary attachments — those go as base64.
 */
export function toJson(name: TableName, row: Row): Row {
  const binary = binaryColumns(name)
  if (binary.length === 0) return row
  const copy: Row = { ...row }
  for (const key of binary) {
    const value = copy[key]
    if (value instanceof Uint8Array) copy[key] = Buffer.from(value).toString('base64')
  }
  return copy
}

/**
 * A JSON row back into a writable form: drops columns the schema does not
 * know (older or foreign file) and converts base64 attachments back to binary.
 * Columns missing from the row are not filled in — defaults are written.
 */
export function fromJson(name: TableName, row: Row): Row {
  const known = columns(name)
  const binary = new Set(binaryColumns(name))
  const result: Row = {}
  for (const [key, value] of Object.entries(row)) {
    if (!Object.prototype.hasOwnProperty.call(known, key)) continue
    if (value === undefined) continue
    result[key] = binary.has(key) && typeof value === 'string' ? Buffer.from(value, 'base64') : value
  }
  return result
}

/**
 * Assignment for `do update`: overwrite everything except `id`. This makes
 * writing repeatable — a second run only aligns the same rows, does not create
 * them again and does not fail on a violated unique key.
 */
function overwrite(name: TableName): Record<string, SQL> {
  const set: Record<string, SQL> = {}
  for (const [key, column] of Object.entries(columns(name))) {
    if (column.name === 'id') continue
    set[key] = sql.raw(`excluded."${column.name}"`)
  }
  return set
}

/**
 * A row's reference to another row of the same table — written only at the
 * end, when both are in the target. A material points to the original of the
 * same content (`duplicate_of_id`), a question to the root of its versions
 * (`variant_of`).
 */
export type SelfReference =
  | { id: string; duplicateOfId: string; duplicateScore: number | null }
  | { id: string; variantOf: string }

/**
 * Splits a batch so no `insert` is unbearably large. The row count is only an
 * upper bound; for materials with long texts the size matters more.
 */
function splitIntoBatches(rows: Row[], max = BATCH_SIZE): Row[][] {
  const batches: Row[][] = []
  let current: Row[] = []
  let bytes = 0
  for (const row of rows) {
    const size = estimateSize(row)
    if (current.length > 0 && (current.length >= max || bytes + size > MAX_BATCH_BYTES)) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(row)
    bytes += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** Rough row size estimate; precision is useless here, only the magnitude matters. */
function estimateSize(row: Row): number {
  let bytes = 0
  for (const value of Object.values(row)) {
    if (typeof value === 'string') bytes += value.length
    else if (value instanceof Uint8Array) bytes += value.byteLength
    else if (value && typeof value === 'object') bytes += JSON.stringify(value).length
    else bytes += 8
  }
  return bytes
}

export interface WriteResult {
  written: number
  /**
   * References within the table (material duplicates, question versions) that
   * must be written once the whole table is in the target — see `writeSelfReferences`.
   */
  links: SelfReference[]
}

/**
 * Writes (or aligns) the rows of one table.
 *
 * Materials and questions have a quirk: `duplicate_of_id` (material) and
 * `variant_of` (question version) point to another row in the same table, so
 * when writing in batches ordered by `id` the original often does not exist
 * yet — a version whose id sorts before its root would fail on the foreign
 * key. The references are therefore left out in the first pass and returned
 * to the caller to write once the whole table is done.
 */
export async function writeRows(
  db: BackupDb,
  name: TableName,
  rows: Row[],
  scope: BackupScope,
): Promise<WriteResult> {
  if (rows.length === 0) return { written: 0, links: [] }

  // Accounts that really exist in the target. Whatever in the file points
  // elsewhere (another school, a long-deleted colleague) goes to whoever
  // started the restore — otherwise the restore would fail on a foreign key
  // or, worse, write data under someone else's identity.
  const knownAccounts = new Set(
    (
      await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.schoolId, scope.schoolId))
    ).map((row) => row.id),
  )
  const who = (value: unknown): string =>
    typeof value === 'string' && knownAccounts.has(value) ? value : scope.userId

  const links: SelfReference[] = []
  const prepared = rows.map((row) => {
    const values = fromJson(name, row)
    if (typeof values.id !== 'string' || values.id.length === 0) {
      throw new BackupRowError(t('backup:errors.rowWithoutId', { table: name }))
    }
    // The school comes from whoever restores, not from the file.
    values.schoolId = scope.schoolId
    for (const column of ['ownerId', 'requestedBy'] as const) {
      if (column in values) values[column] = who(values[column])
    }
    for (const column of ['createdBy', 'reviewedBy'] as const) {
      if (values[column] != null) values[column] = who(values[column])
    }
    if (name === 'materials' && typeof values.duplicateOfId === 'string') {
      links.push({
        id: values.id,
        duplicateOfId: values.duplicateOfId,
        duplicateScore: typeof values.duplicateScore === 'number' ? values.duplicateScore : null,
      })
      values.duplicateOfId = null
    }
    if (name === 'questions' && typeof values.variantOf === 'string') {
      links.push({ id: values.id, variantOf: values.variantOf })
      values.variantOf = null
    }
    return values
  })

  const table = tableOf(name)
  const set = overwrite(name)
  for (const batch of splitIntoBatches(prepared)) {
    try {
      await db
        .insert(table)
        .values(batch as never)
        .onConflictDoUpdate({ target: table.id, set })
    } catch (error) {
      // The whole batch failed but one row is to blame. Go through it again
      // one by one to tell which — the SQLite message alone says nothing
      // actionable.
      for (const row of batch) {
        await db
          .insert(table)
          .values(row as never)
          .onConflictDoUpdate({ target: table.id, set })
          .catch((cause: unknown) => {
            throw explain(name, row, cause ?? error)
          })
      }
      throw error
    }
  }
  return { written: prepared.length, links }
}

/**
 * A restore error whose message explains to the user what went wrong and what
 * to do (same name, missing parent, row without id). Anything else is a
 * technical detail that belongs only in the server log.
 */
export class BackupRowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupRowError'
  }
}

/**
 * Why a row was not written, in words for the user. By far the most common
 * case: the target already has an item of the same name but a different `id`
 * — typically when someone meanwhile created "PŘÍRODOPIS" by hand on the other
 * side too. They cannot be merged by name (two different things with two
 * different histories), so it has to be decided by hand.
 */
function explain(name: TableName, row: Row, cause: unknown): Error {
  const detail = describeError(cause)
  const displayName = [row.name, row.title, row.fileName, row.slug].find(
    (value) => typeof value === 'string' && value.length > 0,
  )
  const item = displayName
    ? t('backup:errors.namedItem', { name: String(displayName), id: String(row.id) })
    : String(row.id)
  if (/unique/i.test(detail)) {
    return new BackupRowError(t('backup:errors.duplicateName', { table: name, item }))
  }
  if (/foreign key/i.test(detail)) {
    return new BackupRowError(t('backup:errors.missingParent', { table: name, item }))
  }
  return new Error(t('backup:errors.writeFailed', { table: name, item, detail }))
}

/**
 * Error text including what caused it. Drizzle wraps SQLite's own message
 * (`UNIQUE constraint failed: …`) in `cause`, so it is not in `message` itself
 * and without this everything would hide under "something went wrong".
 */
function describeError(cause: unknown): string {
  const parts: string[] = []
  let current: unknown = cause
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    parts.push(current.message)
    current = (current as { cause?: unknown }).cause
  }
  return parts.length > 0 ? parts.join(' — ') : String(cause)
}

/**
 * Writes references within a table: a material to the original of the same
 * content and a question version to its root. A reference to a row missing in
 * the target (not transferred, or deleted meanwhile) is silently skipped —
 * an extra material or a version without a link is better than a transfer
 * failing on a foreign key.
 *
 * Both ends of the reference must belong to the restoring user's school: the
 * browser sends the references, so without the school condition a row of
 * another school could be overwritten.
 */
export async function writeSelfReferences(
  db: BackupDb,
  links: SelfReference[],
  scope: { schoolId: string },
): Promise<number> {
  let written = 0
  for (const reference of links) {
    const result =
      'variantOf' in reference
        ? await db.run(sql`
            update questions
            set variant_of = ${reference.variantOf}
            where id = ${reference.id} and school_id = ${scope.schoolId}
              and exists (
                select 1 from questions as root
                where root.id = ${reference.variantOf} and root.school_id = ${scope.schoolId}
              )
          `)
        : await db.run(sql`
            update materials
            set duplicate_of_id = ${reference.duplicateOfId}, duplicate_score = ${reference.duplicateScore}
            where id = ${reference.id} and school_id = ${scope.schoolId}
              and exists (
                select 1 from materials as orig
                where orig.id = ${reference.duplicateOfId} and orig.school_id = ${scope.schoolId}
              )
          `)
    written += Number(result.rowsAffected ?? 0)
  }
  return written
}

/**
 * Reads a table in batches ordered by `id`. A cursor (not `offset`) because it
 * reads via the primary key and memory only ever holds one batch — materials
 * and questions carry full texts and the whole library may not fit.
 */
export async function* readTable(
  db: BackupDb,
  name: TableName,
  scope: { schoolId: string },
  batch = BATCH_SIZE,
): AsyncGenerator<Row[]> {
  const table = tableOf(name)
  const school = eq((table as unknown as { schoolId: AnySQLiteColumn }).schoolId, scope.schoolId)
  const selection = await selectColumns(db, name)
  // Empty selection = columns could not be queried; then the full row is read per schema.
  const full = Object.keys(selection).length === 0
  let last: string | null = null
  for (;;) {
    const base = full ? db.select() : db.select(selection as never)
    const query = base.from(table).orderBy(asc(table.id)).limit(batch)
    const rows = (await (last === null
      ? query.where(school)
      : query.where(and(school, gt(table.id, last))))) as Row[]
    if (rows.length === 0) return
    yield rows
    last = rows[rows.length - 1]!.id as string
    if (rows.length < batch) return
  }
}

/**
 * Tables that really exist in the given database. An old backup or a database
 * that has not run the latest migration simply lacks some table — nothing can
 * be exported from it, but that is no reason for the whole run to fail on
 * "no such table".
 */
export async function existingTables(db: BackupDb): Promise<Set<TableName>> {
  const result = await db.run(sql`select name from sqlite_master where type = 'table'`)
  const found = new Set(result.rows.map((row) => String(row.name)))
  return new Set(TABLE_ORDER.filter((name) => found.has(name)))
}

/**
 * Columns to read: only those really in the database. A database one
 * migration behind (a column was added but not migrated yet) would otherwise
 * fail the whole run on "no such column" — while everything else can be
 * exported from it just fine.
 */
async function selectColumns(db: BackupDb, name: TableName): Promise<Record<string, unknown>> {
  // If the columns cannot be queried, simply read everything per schema —
  // always correct when the database is not a migration behind.
  const result = await db
    .run(sql`select name from pragma_table_info(${name})`)
    .catch(() => null)
  if (!result) return {}
  const present = new Set(result.rows.map((row) => String(row.name)))
  const selection: Record<string, unknown> = {}
  const table = tableOf(name) as unknown as Record<string, unknown>
  for (const [key, column] of Object.entries(columns(name))) {
    if (present.has(column.name)) selection[key] = table[key]
  }
  return selection
}

export type Counts = Record<TableName, number>

/** How much of what is in the database. Used to compare both sides of a transfer. */
export async function countRows(db: BackupDb, scope: { schoolId: string }): Promise<Counts> {
  const present = await existingTables(db)
  const counts = emptyCounts()
  for (const name of TABLE_ORDER) {
    if (!present.has(name)) continue
    const table = tableOf(name)
    const [row] = await db
      .select({ value: sql<number>`count(*)` })
      .from(table)
      .where(eq((table as unknown as { schoolId: AnySQLiteColumn }).schoolId, scope.schoolId))
    counts[name] = Number(row?.value ?? 0)
  }
  return counts
}

/** Empty counts — handy as the starting value when summing. */
export function emptyCounts(): Counts {
  const counts = {} as Counts
  for (const name of TABLE_ORDER) counts[name] = 0
  return counts
}

/**
 * Backup in text chunks. Assembled by hand because there is no point holding
 * the whole file (~2.5 MB today and growing) in memory just to make one
 * string — the response can stream out as it goes.
 */
export async function* backupChunks(
  db: BackupDb,
  scope: { schoolId: string },
): AsyncGenerator<string> {
  yield `{"format":${JSON.stringify(FORMAT)},"verze":${VERSION},"vytvoreno":${JSON.stringify(
    new Date().toISOString(),
  )},"tabulky":{`

  const present = await existingTables(db)
  let firstTable = true
  for (const name of TABLE_ORDER) {
    if (!present.has(name)) continue
    yield `${firstTable ? '' : ','}${JSON.stringify(name)}:[`
    firstTable = false
    let firstRow = true
    for await (const rows of readTable(db, name, scope)) {
      const text = rows.map((row) => JSON.stringify(toJson(name, row))).join(',')
      yield firstRow ? text : `,${text}`
      firstRow = false
    }
    yield ']'
  }

  yield '}}'
}

/** The whole backup as one string — for tests and the script, not for the response. */
export async function backupText(db: BackupDb, scope: { schoolId: string }): Promise<string> {
  let text = ''
  for await (const chunk of backupChunks(db, scope)) text += chunk
  return text
}

/** Name of the downloaded file: `testmaker-zaloha-2026-09-18.json`. */
export function backupFileName(when = new Date()): string {
  return `testmaker-zaloha-${when.toISOString().slice(0, 10)}.json`
}
