import { sessionCookie, clearLegacyCookie } from '@/lib/session'
import { currentUser, endSession, writeAudit } from '@/lib/user'

export const runtime = 'nodejs'

/**
 * Sign-out: the session is marked as ended in the database and the cookie is
 * overwritten with an empty one. Deleting the cookie alone would not do —
 * whoever saved it could come back with it until it expires.
 */
export async function POST() {
  const user = await currentUser()
  if (user && user.sid !== 'bez-prihlaseni') {
    await endSession(user.sid)
    await writeAudit({
      schoolId: user.schoolId,
      userId: user.userId,
      action: 'odhlaseni',
    })
  }

  const response = Response.json({ ok: true })
  response.headers.append('set-cookie', sessionCookie(null))
  response.headers.append('set-cookie', clearLegacyCookie())
  return response
}
