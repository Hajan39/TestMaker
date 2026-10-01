import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

/**
 * Locally a file (`file:./local.db`), on Vercel Turso (`libsql://…` + auth token).
 * In dev mode the client is kept on a global so hot reload does not recreate it.
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
