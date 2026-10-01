import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { afterAll } from 'vitest'
import { DEFAULT_ACCOUNT_ID } from '../src/lib/defaultAccount'

/** The school and account all test data belongs to. */
export const TEST_SCHOOL_ID = 'skola-vyvoj'
export const TEST_ACCOUNT_ID = DEFAULT_ACCOUNT_ID

/**
 * Each test file gets its own empty database in a temporary folder and runs
 * the migrations from `apps/web/drizzle` into it. Tests thus run over the same
 * schema as the app, while the owner's real data (`apps/web/local.db`) stays
 * untouched.
 *
 * This must happen before `@/db` is loaded — the client is created there on
 * import from `DATABASE_URL`. That is why this is a setupFile, not a `beforeAll` in a test.
 */
const dir = mkdtempSync(join(tmpdir(), 'testmaker-test-'))
const file = join(dir, 'test.db')

process.env.DATABASE_URL = `file:${file}`
delete process.env.DATABASE_AUTH_TOKEN

// Safeguard against a typo: if the path pointed at the real database, the
// tests would wipe it. Better to fail right away.
if (!file.startsWith(tmpdir()) || file.includes('local.db')) {
  throw new Error(`Testovací databáze musí být v dočasné složce, ne v ${file}`)
}

// Outside production the app client is kept on a global for hot reload;
// here that would mean sharing the database between files.
delete (globalThis as { __testmakerDb?: unknown }).__testmakerDb

const client = createClient({ url: `file:${file}` })
await migrate(drizzle(client), {
  migrationsFolder: resolve(import.meta.dirname, '..', 'drizzle'),
})

/*
 * The school and account tests work under. Sign-in is off in tests (no
 * `AUTH_SECRET`), so the app behaves as on a laptop and uses the default
 * account — which must really exist in the database, otherwise the foreign
 * keys of tests, puzzles and the queue have nothing to point to.
 */
await client.execute({
  sql: "insert into schools (id, name, slug) values (?, 'Testovací škola', 'test')",
  args: [TEST_SCHOOL_ID],
})
await client.execute({
  sql: "insert into users (id, school_id, email, name, role) values (?, ?, 'test@localhost', 'Testovací správce', 'spravce')",
  args: [TEST_ACCOUNT_ID, TEST_SCHOOL_ID],
})
client.close()

afterAll(() => {
  // On Windows libsql keeps the database file open even after the tests end
  // and deletion fails with EPERM. An uncleaned temp folder beats a red run.
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
})
