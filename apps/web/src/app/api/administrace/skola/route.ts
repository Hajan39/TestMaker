import { z } from 'zod'
import { roleJeAdministrator } from '@/lib/role'
import { prepnoutSkolu } from '@/lib/skoly'
import { sRozsahem, zapsatAudit } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const schema = z.object({ schoolId: z.string().min(1) })

/** Přepne administrátora do jiné školy; volba se uloží k jeho účtu. */
export async function POST(request: Request) {
  return sRozsahem(async (ucet) => {
    if (!roleJeAdministrator(ucet.role)) return Response.json({ error: 'Nenalezeno' }, { status: 404 })

    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })

    if (!(await prepnoutSkolu(ucet, parsed.data.schoolId))) {
      return Response.json({ error: 'Škola se nenašla.' }, { status: 404 })
    }
    await zapsatAudit({
      schoolId: parsed.data.schoolId,
      userId: ucet.userId,
      action: 'administrator-prepnul-skolu',
      entity: 'school',
      entityId: parsed.data.schoolId,
    })
    return Response.json({ ok: true })
  })
}
