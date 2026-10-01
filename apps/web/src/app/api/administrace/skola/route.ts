import { t } from '@testmaker/core/i18n'
import { z } from 'zod'
import { isAdministratorRole } from '@/lib/role'
import { switchSchool } from '@/lib/schools'
import { withScope, writeAudit } from '@/lib/user'

export const runtime = 'nodejs'

const schema = z.object({ schoolId: z.string().min(1) })

/** Switches the administrator to another school; the choice is stored on their account. */
export async function POST(request: Request) {
  return withScope(async (account) => {
    if (!isAdministratorRole(account.role)) return Response.json({ error: t('admin:errors.notFound') }, { status: 404 })

    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: t('admin:errors.invalidData') }, { status: 400 })

    if (!(await switchSchool(account, parsed.data.schoolId))) {
      return Response.json({ error: t('admin:errors.schoolNotFound') }, { status: 404 })
    }
    await writeAudit({
      schoolId: parsed.data.schoolId,
      userId: account.userId,
      action: 'administrator-prepnul-skolu',
      entity: 'school',
      entityId: parsed.data.schoolId,
    })
    return Response.json({ ok: true })
  })
}
