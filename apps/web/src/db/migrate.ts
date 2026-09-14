/** Spustí migrace proti DATABASE_URL (lokální soubor i Turso). */
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'

async function main() {
  const client = createClient({
    url: process.env.DATABASE_URL || 'file:./local.db',
    authToken: process.env.DATABASE_AUTH_TOKEN,
  })
  await migrate(drizzle(client), { migrationsFolder: './drizzle' })
  console.log('Migrace hotové.')
  client.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
