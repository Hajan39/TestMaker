import { z } from 'zod'
import { gradeScaleSchema } from '@testmaker/core/schema'
import { t } from '@testmaker/core/i18n'
import { MANAGEMENT_ROLES } from '@/lib/role'
import { loadGradeScale, saveGradeScale } from '@/lib/schools'
import { withScope, writeAudit } from '@/lib/user'

export const runtime = 'nodejs'

/** The school's grade scale: `{ scale, custom }`, `custom: false` while it is the built-in one. */
export async function GET() {
  return withScope(async (account) => Response.json(await loadGradeScale(account)), { role: MANAGEMENT_ROLES })
}

/** `{ scale }` stores the school's own scale; `{ scale: null }` returns it to the built-in one. */
export async function PUT(request: Request) {
  return withScope(
    async (account) => {
      const parsed = z.object({ scale: gradeScaleSchema.nullable() }).safeParse(await request.json())
      if (!parsed.success) {
        // The first problem the schema words for the manager (the form shows the rest by
        // field); a broken shape — not from our form — gets the general message.
        const worded = new Set([t('core:gradeScale.points'), t('core:gradeScale.percent')])
        const issue = parsed.error.issues.find((one) => one.code === 'custom' || worded.has(one.message))
        return Response.json({ error: issue?.message ?? t('admin:errors.invalidData') }, { status: 400 })
      }

      const result = await saveGradeScale(account, parsed.data.scale)
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

      await writeAudit({
        schoolId: account.schoolId,
        userId: account.userId,
        action: parsed.data.scale ? 'hodnoceni-upraveno' : 'hodnoceni-vychozi',
        entity: 'school',
        entityId: account.schoolId,
      })
      return Response.json(await loadGradeScale(account))
    },
    { role: MANAGEMENT_ROLES },
  )
}
