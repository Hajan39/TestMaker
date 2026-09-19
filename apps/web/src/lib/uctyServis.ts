import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, sessions, users } from '@/db'

/**
 * Odvolání relací bez toho, aby se muselo sáhnout na cookie. Používá ho
 * správa účtů i skript `scripts/uzivatel.ts`, který běží mimo aplikaci —
 * `lib/uzivatel.ts` si žádá kontext požadavku, a ten v příkazové řádce není.
 */
export async function odvolatVsechnyRelaceBezRelace(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId))
  await db
    .update(sessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
}
