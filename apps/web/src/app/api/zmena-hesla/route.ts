import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { t } from '@testmaker/core/i18n'
import { db, users } from '@/db'
import { authMode } from '@/lib/session'
import { verifyPassword, hashPassword, checkPasswordStrength } from '@/lib/password'
import {
  revokeAllSessions,
  withScope,
  createSession,
  writeAudit,
} from '@/lib/user'

export const runtime = 'nodejs'

const bodySchema = z.object({
  oldPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
})

/**
 * Changing one's own password. It requires the current one too: without it,
 * stepping away from an unlocked computer would let someone overwrite it.
 *
 * After the change all sessions including this one are revoked — and a new
 * one is issued right away so changing her own password does not kick the
 * user out.
 */
export async function POST(request: Request) {
  return withScope(async (account) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: t('auth:changePassword.fillBoth') }, { status: 400 })

    const problem = checkPasswordStrength(parsed.data.newPassword)
    if (problem) return Response.json({ error: problem }, { status: 400 })

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, account.userId))
      .limit(1)
    if (!row) return Response.json({ error: t('auth:changePassword.accountMissing') }, { status: 404 })

    if (!(await verifyPassword(parsed.data.oldPassword, row.passwordHash))) {
      return Response.json({ error: t('auth:changePassword.wrongCurrent') }, { status: 401 })
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(parsed.data.newPassword), mustChangePassword: false })
      .where(eq(users.id, account.userId))
    await revokeAllSessions(account.userId)
    await writeAudit({
      schoolId: account.schoolId,
      userId: account.userId,
      action: 'zmena-hesla',
    })

    const response = Response.json({ ok: true })
    // Without sign-in enabled (local run) there is nothing to renew — there
    // is no session and a cookie cannot be signed without a secret.
    if (authMode() === 'zapnuto') {
      response.headers.append(
        'set-cookie',
        await createSession(account.userId, {
          ip: request.headers.get('x-forwarded-for'),
          userAgent: request.headers.get('user-agent'),
        }),
      )
    }
    return response
  })
}
