import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Migration 0006 flips drafts to approved. Tested on its own database built
 * from scratch, not the one from `test/setup.ts`: there the migration ran long
 * ago over an empty table and its effect on data would not be visible.
 *
 * Procedure: first the schema is built with migrations up to 0005 (a copy of
 * the `drizzle` folder with a truncated journal), questions in all three
 * states are inserted, and only then the full set of migrations runs,
 * including 0006.
 */
// Data migrations from the old series; a clean database is now created by the single baseline.
const drizzleFolder = resolve(import.meta.dirname, '..', 'drizzle-historie')
const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup()
    } catch {}
  }
})

/** A copy of the migrations folder whose journal ends at the given migration. */
function migrationsUpTo(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'testmaker-drizzle-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  cpSync(drizzleFolder, dir, { recursive: true })

  const journalPath = join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  const end = journal.entries.findIndex((entry) => entry.tag === tag)
  expect(end).toBeGreaterThanOrEqual(0)
  journal.entries = journal.entries.slice(0, end + 1)
  writeFileSync(journalPath, JSON.stringify(journal, null, 2))
  return dir
}

function freshDb(): { client: Client; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'testmaker-migrace-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'migrace.db')
  const client = createClient({ url: `file:${file}` })
  cleanups.push(() => client.close())
  return { client, file }
}

async function insertQuestion(client: Client, id: string, status: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO questions (id, topic_id, material_id, type, payload, blocks, points, difficulty, source, status)
          VALUES (?, NULL, NULL, 'short_answer', ?, '[]', 1, 2, 'ai', ?)`,
    args: [id, JSON.stringify({ prompt: `Otázka ${id}`, answer: 'x', acceptedAnswers: [] }), status],
  })
}

async function countsByStatus(client: Client): Promise<Record<string, number>> {
  const result = await client.execute('SELECT status, count(*) AS pocet FROM questions GROUP BY status')
  return Object.fromEntries(result.rows.map((row) => [String(row.status), Number(row.pocet)]))
}

describe('migration 0006 — bulk approval of drafts', () => {
  it('flips drafts and records only them in the helper table', async () => {
    const { client } = freshDb()
    await migrate(drizzle(client), { migrationsFolder: migrationsUpTo('0005_materials-hash-per-topic') })

    await insertQuestion(client, 'koncept-1', 'draft')
    await insertQuestion(client, 'koncept-2', 'draft')
    await insertQuestion(client, 'schvalena', 'approved')
    await insertQuestion(client, 'zamitnuta', 'rejected')

    expect(await countsByStatus(client)).toEqual({ draft: 2, approved: 1, rejected: 1 })

    await migrate(drizzle(client), { migrationsFolder: drizzleFolder })

    // Drafts are gone, approved ones grew by them, the rejected one stayed rejected.
    expect(await countsByStatus(client)).toEqual({ approved: 3, rejected: 1 })

    // The helper table holds exactly the affected questions — neither the
    // previously approved nor the rejected one. Otherwise a rollback would undo others' work.
    const noted = await client.execute(
      'SELECT question_id FROM migration_0006_approved_drafts ORDER BY question_id',
    )
    expect(noted.rows.map((row) => String(row.question_id))).toEqual(['koncept-1', 'koncept-2'])
  })

  it('can be rolled back with the procedure from the migration comment', async () => {
    const { client } = freshDb()
    await migrate(drizzle(client), { migrationsFolder: migrationsUpTo('0005_materials-hash-per-topic') })

    await insertQuestion(client, 'koncept', 'draft')
    await insertQuestion(client, 'koncept-pozdeji-zamitnuty', 'draft')
    await insertQuestion(client, 'schvalena-rucne', 'approved')

    await migrate(drizzle(client), { migrationsFolder: drizzleFolder })

    // Meanwhile the teacher rejects one of the flipped questions.
    await client.execute("UPDATE questions SET status = 'rejected' WHERE id = 'koncept-pozdeji-zamitnuty'")

    // Rollback per the procedure in `docs/migrace-0006-schvaleni-konceptu.md`.
    await client.execute(`UPDATE questions SET status = 'draft'
       WHERE status = 'approved'
         AND id IN (SELECT question_id FROM migration_0006_approved_drafts)`)
    await client.execute('DROP TABLE migration_0006_approved_drafts')

    expect(await countsByStatus(client)).toEqual({ draft: 1, approved: 1, rejected: 1 })

    const states = await client.execute('SELECT id, status FROM questions ORDER BY id')
    expect(Object.fromEntries(states.rows.map((row) => [String(row.id), String(row.status)]))).toEqual({
      koncept: 'draft',
      'koncept-pozdeji-zamitnuty': 'rejected',
      'schvalena-rucne': 'approved',
    })
  })
})
