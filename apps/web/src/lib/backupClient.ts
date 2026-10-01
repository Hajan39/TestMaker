/**
 * Restore from backup on the browser side.
 *
 * Uploading is subject to a 4.5 MB per-request cap (Vercel), so the file is
 * sliced here: table by table, in batches, and sent to `/api/export`. The
 * file itself keeps the table order — the backup is written with parents
 * before the items referencing them, and JSON preserves key order.
 *
 * Deliberately no import of `lib/backup`: it touches the database schema and
 * does not belong in the browser.
 */

import { t } from '@testmaker/core/i18n'
import { jsonBody, requestJson } from '@/lib/requestJson'

/** A backup row; what it contains is checked by the server against the schema. */
type Row = Record<string, unknown>

export interface Backup {
  format: string
  verze: number
  vytvoreno?: string
  tabulky: Record<string, Row[]>
}

export interface Progress {
  table: string
  done: number
  total: number
}

/** Maximum rows in one batch. */
const BATCH_SIZE = 200

/**
 * Cap on one batch's size. Vercel accepts requests up to 4.5 MB; two
 * megabytes is a big enough bite for the restore not to take forever, with
 * room to spare for headers and JSON bloat.
 */
const MAX_BYTES = 2_000_000

const FORMAT = 'testmaker-zaloha'

/**
 * Reads and validates a backup file. The errors tell the user what happened
 * — most often a completely different file ends up here.
 */
export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(t('backup:errors.invalidJson'))
  }
  if (!data || typeof data !== 'object') throw new Error(t('backup:errors.empty'))
  const backup = data as Partial<Backup>
  if (backup.format !== FORMAT) {
    throw new Error(t('backup:errors.notBackup'))
  }
  if (!backup.tabulky || typeof backup.tabulky !== 'object') {
    throw new Error(t('backup:errors.corrupted'))
  }
  return { format: backup.format, verze: backup.verze ?? 1, vytvoreno: backup.vytvoreno, tabulky: backup.tabulky }
}

/** How much of what the backup contains — for the confirmation before restoring. */
export function countsInBackup(backup: Backup): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [name, rows] of Object.entries(backup.tabulky)) {
    counts[name] = Array.isArray(rows) ? rows.length : 0
  }
  return counts
}

/**
 * A reference to another row of the same table — a material to the original
 * of the same content, a question version to its root. Written once the whole
 * table is in the target.
 */
type SelfReference =
  | { id: string; duplicateOfId: string; duplicateScore: number | null }
  | { id: string; variantOf: string }

/**
 * Uploads a backup back into the library. Merging is by `id` and nothing is
 * deleted, so the same file can be uploaded repeatedly without duplicating
 * anything.
 *
 * Returns the row counts the server accepted — the UI builds the "what was
 * loaded" list from them.
 */
export async function restoreFromBackup(
  backup: Backup,
  onProgress?: (progress: Progress) => void,
): Promise<Record<string, number>> {
  const restored: Record<string, number> = {}
  const links = new Map<string, SelfReference[]>()

  for (const [table, rows] of Object.entries(backup.tabulky)) {
    if (!Array.isArray(rows) || rows.length === 0) {
      restored[table] = 0
      continue
    }
    let done = 0
    onProgress?.({ table, done, total: rows.length })
    for (const batch of splitIntoBatches(rows)) {
      const response = await send({ table, rows: batch })
      done += Number(response.written ?? 0)
      if (Array.isArray(response.links) && response.links.length > 0) {
        const tableLinks = links.get(table) ?? []
        tableLinks.push(...(response.links as SelfReference[]))
        links.set(table, tableLinks)
      }
      onProgress?.({ table, done, total: rows.length })
    }
    restored[table] = done
  }

  // A material marked as a duplicate points to another material, a question
  // version to its root; during batched writing that may still have been
  // missing in the target, so the references are written only now.
  for (const [table, list] of links) {
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      await send({ table, links: list.slice(i, i + BATCH_SIZE) })
    }
  }

  return restored
}

/** Splits rows into batches by count and by size in bytes. */
function splitIntoBatches(rows: Row[]): Row[][] {
  const batches: Row[][] = []
  let current: Row[] = []
  let bytes = 0
  for (const row of rows) {
    const size = JSON.stringify(row).length
    if (current.length > 0 && (current.length >= BATCH_SIZE || bytes + size > MAX_BYTES)) {
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

async function send(body: unknown): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/export', jsonBody('POST', body), t('backup:errors.restoreFailed'))
}

/**
 * Tables with a translated name. The UI and the transfer overview use the
 * same words, so the teacher and the owner read the same thing.
 */
const NAMED_TABLES = [
  'subjects',
  'grades',
  'topics',
  'materials',
  'assets',
  'questions',
  'puzzles',
  'templates',
  'tests',
  'test_items',
] as const

type NamedTable = (typeof NAMED_TABLES)[number]

function isNamedTable(name: string): name is NamedTable {
  return (NAMED_TABLES as readonly string[]).includes(name)
}

/** The count with the table's word in the right form; an unknown table keeps just its name. */
export function tableCount(name: string, count: number): string {
  return isNamedTable(name) ? t(`backup:tableCounts.${name}`, { count }) : `${count} ${name}`
}

/** The table's name in the plural ("materiály") — a label, not a count. */
export function tableLabel(name: string): string {
  return isNamedTable(name) ? t(`backup:tableNames.${name}`) : name
}
