import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterEach, describe, expect, it } from 'vitest'
import { HELPER_TABLES, HISTORY_DIR, BASELINE_DIR, upgradeDatabase, compareWithBaseline } from '@/db/legacyMigrations'

/**
 * The clean baseline and converting a database from the old migration series.
 * Each test has its own in-memory database — the shared one from
 * `test/setup.ts` is already on the baseline and would not show the old
 * series. Not a file: on Windows libsql keeps it open even after `close()`
 * and the temp folder could not be deleted.
 */
const cleanup: (() => void)[] = []

/** The baseline and the migrations added after it. */
const MIGRATION_COUNT = readMigrationFiles({ migrationsFolder: BASELINE_DIR }).length

afterEach(() => {
  for (const step of cleanup.splice(0)) step()
})

function newDatabase(): Client {
  const client = createClient({ url: ':memory:' })
  cleanup.push(() => client.close())
  return client
}

async function tables(client: Client): Promise<string[]> {
  const rows = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  return rows.rows.map((r) => String(r.name))
}

describe('clean database', () => {
  it('is created from the single baseline, without helper tables or data', async () => {
    const client = newDatabase()
    expect(await upgradeDatabase(client)).toBe('aktualni')

    const names = await tables(client)
    for (const helper of HELPER_TABLES) expect(names).not.toContain(helper)
    expect((await client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')).rows[0]?.n).toBe(MIGRATION_COUNT)
    expect((await client.execute('SELECT COUNT(*) AS n FROM schools')).rows[0]?.n).toBe(0)
    expect((await client.execute('SELECT COUNT(*) AS n FROM users')).rows[0]?.n).toBe(0)
  })
})

describe('conversion from the old series', () => {
  async function oldDatabase(): Promise<Client> {
    const client = newDatabase()
    await migrate(drizzle(client), { migrationsFolder: HISTORY_DIR })
    // The old series created the school and account itself (migration 0011); we add content.
    await client.batch(
      [
        "INSERT INTO subjects (id, school_id, name) VALUES ('predmet-1', 'skola-zakladatelka', 'PŘÍRODOPIS')",
        "INSERT INTO grades (id, school_id, subject_id, name) VALUES ('rocnik-1', 'skola-zakladatelka', 'predmet-1', '6. ročník')",
      ],
      'write',
    )
    return client
  }

  it('keeps data, drops helper tables and aligns the schema with the baseline', async () => {
    const client = await oldDatabase()
    expect((await compareWithBaseline(client)).length).toBeGreaterThan(0)

    expect(await upgradeDatabase(client)).toBe('prevedeno')

    expect(await compareWithBaseline(client)).toEqual([])
    const names = await tables(client)
    for (const helper of HELPER_TABLES) expect(names).not.toContain(helper)
    expect(names.some((j) => j.startsWith('__prestavba_'))).toBe(false)
    expect((await client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')).rows[0]?.n).toBe(MIGRATION_COUNT)

    const grade = await client.execute("SELECT name, subject_id FROM grades WHERE id = 'rocnik-1'")
    expect(grade.rows[0]).toMatchObject({ name: '6. ročník', subject_id: 'predmet-1' })
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([])
  })

  it('after conversion foreign keys cascade deletes as in the baseline', async () => {
    const client = await oldDatabase()
    await upgradeDatabase(client)
    await client.execute('PRAGMA foreign_keys = ON')
    await client.execute("DELETE FROM subjects WHERE id = 'predmet-1'")
    expect((await client.execute("SELECT COUNT(*) AS n FROM grades")).rows[0]?.n).toBe(0)
  })

  it('a second run converts nothing', async () => {
    const client = await oldDatabase()
    await upgradeDatabase(client)
    expect(await upgradeDatabase(client)).toBe('aktualni')
  })

  it('leaves a schema the conversion cannot fix unchanged and reports it', async () => {
    const client = await oldDatabase()
    await client.execute('ALTER TABLE subjects ADD COLUMN navic text')

    await expect(upgradeDatabase(client)).rejects.toThrow(/navíc sloupec subjects\.navic/)
    const names = await tables(client)
    expect(names).toContain('migration_0011_vlastnictvi')
    expect((await client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')).rows[0]?.n).toBeGreaterThan(1)
  })
})
