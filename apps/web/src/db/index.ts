import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

/**
 * Lokálně soubor (`file:./local.db`), na Vercelu Turso (`libsql://…` + auth token).
 * Klient se v dev režimu drží na globálu, aby ho hot reload nevytvářel znovu.
 */
const globalForDb = globalThis as unknown as { __testmakerDb?: ReturnType<typeof create> }

function create() {
  const url = process.env.DATABASE_URL || 'file:./local.db'
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN })
  return drizzle(client, { schema })
}

export const db = globalForDb.__testmakerDb ?? create()
if (process.env.NODE_ENV !== 'production') globalForDb.__testmakerDb = db

export { schema }
export * from './schema'
