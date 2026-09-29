import { ROLE_SPRAVY } from '@/lib/role'
import { upravitSkolu, zmenySkolySchema } from '@/lib/skoly'
import { sRozsahem, zapsatAudit } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/** Správce upraví školu, ve které pracuje: název, doménu Google, automatické přiřazení. */
export async function PATCH(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const parsed = zmenySkolySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })

      const vysledek = await upravitSkolu(ucet, ucet.schoolId, parsed.data)
      if (!vysledek.ok) return Response.json({ error: vysledek.chyba }, { status: vysledek.status })

      await zapsatAudit({
        schoolId: ucet.schoolId,
        userId: ucet.userId,
        action: 'skola-upravena',
        entity: 'school',
        entityId: ucet.schoolId,
        detail: parsed.data,
      })
      return Response.json({ ok: true })
    },
    { role: ROLE_SPRAVY },
  )
}
