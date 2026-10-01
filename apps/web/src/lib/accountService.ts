import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, sessions, users } from '@/db'

/**
 * Revokes sessions without touching the cookie. Used by account management and
 * by the `scripts/user.ts` script, which runs outside the app — `lib/user.ts`
 * needs a request context, and the command line has none.
 */
export async function revokeAllSessionsStandalone(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId))
  await db
    .update(sessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
}
