/**
 * Runs migrations against DATABASE_URL (local file and Turso). A database from
 * the old migration series is converted to the clean baseline — see
 * `db/legacyMigrations.ts`.
 */
import { existsSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { migrationPending, upgradeDatabase } from './legacyMigrations'

async function main() {
  const url = process.env.DATABASE_URL || 'file:./local.db'
  // The file's existence must be checked before the client creates it empty.
  const file = url.startsWith('file:') ? url.slice('file:'.length) : null
  const existed = file !== null && existsSync(file)
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN })

  // For a file, a backup is made next to it before migrating; Turso has its
  // own point-in-time restore.
  if (file && existed && (await migrationPending(client))) {
    const backup = `${file}.pred-migraci-${new Date().toISOString().replace(/[:.]/g, '-')}`
    // `VACUUM INTO` gives a consistent snapshot including what is still in the -wal file.
    await client.execute({ sql: 'VACUUM INTO ?', args: [backup] })
    console.log(`Záloha: ${backup}`)
  }

  const result = await upgradeDatabase(client)
  console.log(
    result === 'prevedeno'
      ? 'Databáze převedena ze staré řady migrací na čistý základ; data zůstala.'
      : 'Migrace hotové.',
  )
  client.close()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
