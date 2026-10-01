/**
 * Deletes the whole database and rebuilds it clean: migrations, the first
 * school with templates and an administrator with a default password that
 * must be changed at first sign-in. All content (library, questions, tests,
 * accounts) disappears.
 *
 *   DATABASE_URL=… DATABASE_AUTH_TOKEN=… ADMIN_HESLO=… \
 *   pnpm --filter @testmaker/web db:vycistit -- \
 *     --potvrdit <database name> --skola "School name" --email admin@skola.cz
 *
 * For Turso the database name is the first part of the address
 * (`libsql://<name>.turso.io`), for a file its name (`local.db`). Without a
 * match nothing happens — a script started by mistake must not delete a
 * different database than the author had in mind.
 *
 * Before deleting, the whole content is dumped into `zaloha-<name>-<time>.sql`
 * in the current folder (schema and data as SQL statements); it can be
 * restored via `sqlite3` or `turso db shell`. The `vycistit-databazi.yml`
 * workflow stores it as an artifact.
 *
 * The password is not passed as a switch (it would stay in the command
 * history) but via the `ADMIN_HESLO` variable.
 */
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createClient, type Client, type Value } from '@libsql/client'
import { loadEnv } from './env'

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  const value = index < 0 ? undefined : process.argv[index + 1]
  return value && !value.startsWith('--') ? value.trim() : null
}

/** Database name from the address, compared with the confirmation. */
function databaseName(url: string): string {
  if (url.startsWith('file:')) return basename(url.slice('file:'.length))
  return new URL(url).hostname.split('.')[0] ?? url
}

function sqlValue(value: Value): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (value instanceof ArrayBuffer) return `X'${Buffer.from(value).toString('hex')}'`
  return `'${String(value).replaceAll("'", "''")}'`
}

/**
 * The whole database as SQL statements. `ponytail:` each table is read into
 * memory at once; enough for one school's library, large data would be read
 * in pages.
 */
async function dump(client: Client): Promise<string> {
  const objs = await client.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'index', name",
  )
  const rows = ['PRAGMA foreign_keys = OFF;', 'BEGIN;']
  for (const obj of objs.rows) {
    rows.push(`${String(obj.sql)};`)
    if (obj.type !== 'table') continue
    const data = await client.execute(`SELECT * FROM "${String(obj.name)}"`)
    const columns = data.columns.map((c) => `"${c}"`).join(', ')
    for (const row of data.rows) {
      const values = data.columns.map((_, i) => sqlValue(row[i] ?? null)).join(', ')
      rows.push(`INSERT INTO "${String(obj.name)}" (${columns}) VALUES (${values});`)
    }
  }
  rows.push('COMMIT;')
  return `${rows.join('\n')}\n`
}

async function main(): Promise<void> {
  loadEnv()
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Chybí DATABASE_URL — skript nesmí sáhnout na výchozí local.db sám od sebe.')

  const name = databaseName(url)
  const confirmation = flag('potvrdit')
  if (confirmation !== name) {
    throw new Error(`Potvrzení nesedí: databáze se jmenuje „${name}“, přepínač --potvrdit musí mít přesně tuhle hodnotu.`)
  }
  const schoolName = flag('skola')
  const email = flag('email')?.toLowerCase()
  const password = process.env.ADMIN_HESLO ?? ''
  if (!schoolName || !email) throw new Error('Chybí --skola nebo --email pro první školu a administrátora.')

  // The password is checked before anything is deleted.
  const { hashPassword, checkPasswordStrength } = await import('../src/lib/password')
  const problem = password ? checkPasswordStrength(password) : 'Chybí proměnná ADMIN_HESLO s výchozím heslem administrátora.'
  if (problem) throw new Error(problem)

  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN })
  try {
    const backup = `zaloha-${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`
    writeFileSync(backup, await dump(client))
    console.log(`Záloha: ${backup}`)

    // All at once with foreign keys off (`client.migrate`), as in the
    // conversion in `db/legacyMigrations.ts`: a half-deleted database must not remain.
    const objs = await client.execute(
      "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%'",
    )
    await client.migrate(objs.rows.map((o) => `DROP ${String(o.type).toUpperCase()} IF EXISTS "${String(o.name)}"`))
    console.log(`Smazáno ${objs.rows.length} tabulek a dalších objektů.`)

    const { upgradeDatabase } = await import('../src/db/legacyMigrations')
    await upgradeDatabase(client)
    console.log('Migrace hotové.')
  } finally {
    client.close()
  }

  const { db, schools, users } = await import('../src/db/index')
  const { seedTemplates } = await import('../src/db/templates')
  const { newId } = await import('../src/lib/ids')
  const { slugFromName } = await import('../src/lib/schoolText')

  const [school] = await db.insert(schools).values({ id: newId(), name: schoolName, slug: slugFromName(schoolName) }).returning()
  await seedTemplates(db, school!.id)
  await db.insert(users).values({
    id: newId(),
    schoolId: school!.id,
    email,
    name: 'Administrátor',
    role: 'administrator',
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    status: 'aktivni',
  })
  console.log(`Založena škola ${schoolName} a administrátor ${email}; heslo se změní při prvním přihlášení.`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
