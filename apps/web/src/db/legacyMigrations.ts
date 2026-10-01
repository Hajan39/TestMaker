/**
 * Database migrations, including conversion from the old series.
 *
 * Until September 2026 the schema grew through twenty-one migrations (now in
 * the `drizzle-historie` folder). Some of them moved data and left helper
 * tables `migration_00xx_*` behind for a possible rollback, and 0011 created
 * the founding school and account. A clean database is now created by the
 * single migration `drizzle/0000_zaklad.sql`, without helper tables or data.
 *
 * A database from the old series (`local.db`, the first Turso deployment) is
 * converted automatically: the remaining old migrations run, the schema is
 * checked against the baseline, helper tables are dropped and
 * `__drizzle_migrations` keeps a single baseline row. Data stays as it is.
 * When the schema does not match, nothing is overwritten and the migration
 * fails with a list of differences.
 *
 * No `@/` alias — the module is read by `db/migrate.ts` run via `tsx`.
 */
import { resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const webRoot = resolve(import.meta.dirname, '..', '..')
export const BASELINE_DIR = resolve(webRoot, 'drizzle')
export const HISTORY_DIR = resolve(webRoot, 'drizzle-historie')

/** Helper tables of the old data migrations; meaningless after the conversion. */
export const HELPER_TABLES = [
  'migration_0006_approved_drafts',
  'migration_0011_vlastnictvi',
  'migration_0012_linked_questions',
  'migration_0014_approved_drafts',
]

export type MigrationResult = 'aktualni' | 'prevedeno'

export async function upgradeDatabase(
  client: Client,
  folders: { base?: string; history?: string } = {},
): Promise<MigrationResult> {
  const base = folders.base ?? BASELINE_DIR
  const history = folders.history ?? HISTORY_DIR
  const [first] = readMigrationFiles({ migrationsFolder: base })
  if (!first) throw new Error(`Ve složce ${base} není žádná migrace.`)

  if (!(await isLegacySeries(client, first.folderMillis))) {
    await migrate(drizzle(client), { migrationsFolder: base })
    return 'aktualni'
  }

  // Old series: first run it to the end so the same state is compared.
  await migrate(drizzle(client), { migrationsFolder: history })

  const clean = createClient({ url: ':memory:' })
  try {
    // Compare only with the baseline: migrations added after it run only
    // after the conversion. If they were part of the comparison, the old
    // database would lack their columns and the conversion would end up
    // "unfixable".
    await clean.migrate(first.sql)
    const differences = schemaDifferences(await describeSchema(clean), await describeSchema(client))

    // A missing or extra table or column is not fixed by the conversion —
    // that would mean making up data. A different type, default, foreign key
    // or index is: the table is rebuilt into the exact baseline shape.
    const unfixable = differences.filter((r) => !r.fixable)
    if (unfixable.length > 0) {
      throw new Error(
        'Schéma databáze se liší od čistého základu tak, že převod nejde provést; nic se nezměnilo:\n' +
          unfixable.map((r) => `  - ${r.description}`).join('\n'),
      )
    }
    await checkForeignKeys(client, 'před převodem')

    const rebuildTable = [...new Set(differences.map((r) => r.table))].sort()
    const commands: string[] = []
    for (const table of rebuildTable) commands.push(...(await tablesToRebuild(clean, client, table)))

    // All at once with foreign keys off (`client.migrate`): rebuilding a table
    // others point to would otherwise fail, and a half-done conversion must
    // not remain.
    await client.migrate([
      ...commands,
      ...HELPER_TABLES.map((table) => `DROP TABLE IF EXISTS \`${table}\``),
      'DELETE FROM `__drizzle_migrations`',
      {
        sql: 'INSERT INTO `__drizzle_migrations` ("hash", "created_at") VALUES (?, ?)',
        args: [first.hash, first.folderMillis],
      },
    ])

    await checkForeignKeys(client, 'po převodu')
    const remaining = schemaDifferences(await describeSchema(clean), await describeSchema(client))
    if (remaining.length > 0) {
      throw new Error(
        'Převod doběhl, ale schéma se od základu pořád liší — obnov databázi ze zálohy:\n' +
          remaining.map((r) => `  - ${r.description}`).join('\n'),
      )
    }
  } finally {
    clean.close()
  }

  // More migrations may follow the baseline; those run the usual way.
  await migrate(drizzle(client), { migrationsFolder: base })
  return 'prevedeno'
}

/**
 * Statements that rebuild a table into the baseline shape (the procedure from
 * the SQLite docs "Making Other Kinds Of Table Schema Changes"): a new table
 * under a temporary name, copying data, dropping the old one, renaming, indexes.
 */
async function tablesToRebuild(clean: Client, client: Client, table: string): Promise<string[]> {
  const ddl = await clean.execute({
    sql: "SELECT type, sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY type = 'index'",
    args: [table],
  })
  const creation = ddl.rows.find((r) => r.type === 'table')
  if (!creation) throw new Error(`Tabulka ${table} v základu není.`)
  const temporary = `__prestavba_${table}`
  const columns = (await clean.execute(`PRAGMA table_info(\`${table}\`)`)).rows
    .map((r) => `\`${r.name}\``)
    .join(', ')
  return [
    String(creation.sql).replace(`CREATE TABLE \`${table}\``, `CREATE TABLE \`${temporary}\``),
    `INSERT INTO \`${temporary}\` (${columns}) SELECT ${columns} FROM \`${table}\``,
    `DROP TABLE \`${table}\``,
    `ALTER TABLE \`${temporary}\` RENAME TO \`${table}\``,
    ...ddl.rows.filter((r) => r.type === 'index').map((r) => String(r.sql)),
  ]
}

async function checkForeignKeys(client: Client, when: string): Promise<void> {
  const violations = await client.execute('PRAGMA foreign_key_check')
  if (violations.rows.length === 0) return
  const sample = violations.rows
    .slice(0, 5)
    .map((r) => `${r.table} (řádek ${r.rowid}) → ${r.parent}`)
    .join(', ')
  throw new Error(`Cizí klíče nesedí ${when}: ${violations.rows.length}× — např. ${sample}.`)
}

interface Difference {
  table: string
  description: string
  fixable: boolean
}

const KINDS = ['tabulka', 'sloupec', 'cizí klíč', 'index'] as const

function schemaDifferences(expected: Map<string, string>, actual: Map<string, string>): Difference[] {
  const differences: Difference[] = []
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    const a = expected.get(key)
    const b = actual.get(key)
    if (a === b) continue
    const kind = KINDS.find((d) => key.startsWith(`${d} `))!
    const subject = key.slice(kind.length + 1)
    const table = kind === 'index' ? (JSON.parse(a ?? b!) as string[])[0]! : subject.split('.')[0]!
    const description =
      a === undefined ? `navíc ${key}: ${b}` : b === undefined ? `chybí ${key}: ${a}` : `jinak ${key}: čeká se ${a}, je ${b}`
    const missingOrExtra = a === undefined || b === undefined
    differences.push({
      table,
      description,
      fixable: !(kind === 'tabulka' || (kind === 'sloupec' && missingOrExtra)),
    })
  }
  return differences
}

/** Is any migration (or conversion) pending for the database? A backup is made accordingly. */
export async function migrationPending(client: Client, base: string = BASELINE_DIR): Promise<boolean> {
  const migration = readMigrationFiles({ migrationsFolder: base })
  const last = migration.at(-1)
  if (!last) return false
  return (await lastMigration(client)) < last.folderMillis
}

/** Time of the last recorded migration; `-1` when the database has none. */
async function lastMigration(client: Client): Promise<number> {
  const table = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  )
  if (table.rows.length === 0) return -1
  const result = await client.execute('SELECT MAX(created_at) AS last_at FROM `__drizzle_migrations`')
  const time = result.rows[0]?.last_at
  return time === null || time === undefined ? -1 : Number(time)
}

/**
 * Old series = the database already has a schema but its last recorded
 * migration is older than the baseline. An empty database is not the old
 * series; it gets the baseline directly.
 */
async function isLegacySeries(client: Client, baselineTime: number): Promise<boolean> {
  const time = await lastMigration(client)
  return time >= 0 && time < baselineTime
}

/** Schema differences against a clean database built from the baseline, human-readable. */
export async function compareWithBaseline(client: Client, base: string = BASELINE_DIR): Promise<string[]> {
  const clean = createClient({ url: ':memory:' })
  try {
    await migrate(drizzle(clean), { migrationsFolder: base })
    return schemaDifferences(await describeSchema(clean), await describeSchema(client)).map((r) => r.description)
  } finally {
    clean.close()
  }
}

/**
 * The schema as a "what → description" map: columns (type, NOT NULL, default,
 * primary key), foreign keys and indexes. Column order is not compared — a
 * column added via ALTER TABLE is always last, and it does not affect behaviour.
 */
async function describeSchema(client: Client): Promise<Map<string, string>> {
  const description = new Map<string, string>()
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
      "AND name != '__drizzle_migrations' AND name NOT LIKE 'migration_0%' ORDER BY name",
  )
  for (const { name } of tables.rows) {
    const table = String(name)
    description.set(`tabulka ${table}`, 'ano')

    const columns = await client.execute(`PRAGMA table_info(\`${table}\`)`)
    for (const s of columns.rows) {
      description.set(
        `sloupec ${table}.${s.name}`,
        JSON.stringify([String(s.type).toLowerCase(), s.notnull, s.dflt_value, s.pk]),
      )
    }

    const keys = await client.execute(`PRAGMA foreign_key_list(\`${table}\`)`)
    for (const k of keys.rows) {
      description.set(
        `cizí klíč ${table}.${k.from}`,
        JSON.stringify([k.table, k.to, String(k.on_delete).toLowerCase()]),
      )
    }

    const indexes = await client.execute(`PRAGMA index_list(\`${table}\`)`)
    for (const i of indexes.rows) {
      // Automatic indexes (primary key, column UNIQUE) are named by creation
      // order, so only the named ones are compared.
      if (String(i.name).startsWith('sqlite_autoindex_')) continue
      const indexColumns = await client.execute(`PRAGMA index_info(\`${i.name}\`)`)
      description.set(
        `index ${i.name}`,
        JSON.stringify([table, i.unique, indexColumns.rows.map((r) => r.name)]),
      )
    }
  }
  return description
}
