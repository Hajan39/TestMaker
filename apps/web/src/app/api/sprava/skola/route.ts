import { t } from '@testmaker/core/i18n'
import { MANAGEMENT_ROLES } from '@/lib/role'
import { updateSchool, schoolChangesSchema } from '@/lib/schools'
import { withScope, writeAudit } from '@/lib/user'

export const runtime = 'nodejs'

/** A manager edits the school they work in: name, Google domain, automatic joining. */
export async function PATCH(request: Request) {
  return withScope(
    async (account) => {
      const parsed = schoolChangesSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: t('admin:errors.invalidData') }, { status: 400 })

      const result = await updateSchool(account, account.schoolId, parsed.data)
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

      await writeAudit({
        schoolId: account.schoolId,
        userId: account.userId,
        action: 'skola-upravena',
        entity: 'school',
        entityId: account.schoolId,
        detail: parsed.data,
      })
      return Response.json({ ok: true })
    },
    { role: MANAGEMENT_ROLES },
  )
}
