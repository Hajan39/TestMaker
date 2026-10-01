import { t } from '@testmaker/core/i18n'
import { z } from 'zod'
import { isAdministratorRole } from '@/lib/role'
import { listSchools, updateSchool, createSchool, schoolChangesSchema } from '@/lib/schools'
import { withScope, writeAudit, type SignedInUser } from '@/lib/user'

export const runtime = 'nodejs'

const createSchema = schoolChangesSchema.extend({ name: z.string().max(200) })
const updateSchema = schoolChangesSchema.extend({ id: z.string().min(1) })

/**
 * School administration. Anyone who is not an administrator gets 404 — the
 * response must not reveal that anything is here at all.
 */
function adminOnly(handler: (account: SignedInUser) => Promise<Response>): Promise<Response> {
  return withScope(async (account) => {
    if (!isAdministratorRole(account.role)) return Response.json({ error: t('admin:errors.notFound') }, { status: 404 })
    return handler(account)
  })
}

export async function GET() {
  return adminOnly(async (account) => Response.json({ schools: (await listSchools(account)) ?? [] }))
}

export async function POST(request: Request) {
  return adminOnly(async (account) => {
    const parsed = createSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: t('admin:errors.invalidData') }, { status: 400 })

    const result = await createSchool(account, parsed.data)
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

    await writeAudit({
      schoolId: result.id,
      userId: account.userId,
      action: 'skola-zalozena',
      entity: 'school',
      entityId: result.id,
      detail: parsed.data,
    })
    return Response.json({ id: result.id })
  })
}

export async function PATCH(request: Request) {
  return adminOnly(async (account) => {
    const parsed = updateSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: t('admin:errors.invalidData') }, { status: 400 })

    const { id, ...changes } = parsed.data
    const result = await updateSchool(account, id, changes)
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

    await writeAudit({
      schoolId: id,
      userId: account.userId,
      action: 'skola-upravena',
      entity: 'school',
      entityId: id,
      detail: changes,
    })
    return Response.json({ ok: true })
  })
}
