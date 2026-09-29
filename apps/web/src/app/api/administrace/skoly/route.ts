import { z } from 'zod'
import { roleJeAdministrator } from '@/lib/role'
import { seznamSkol, upravitSkolu, zalozitSkolu, zmenySkolySchema } from '@/lib/skoly'
import { sRozsahem, zapsatAudit, type Prihlaseny } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const zalozitSchema = zmenySkolySchema.extend({ name: z.string().max(200) })
const upravitSchema = zmenySkolySchema.extend({ id: z.string().min(1) })

/**
 * Administrace škol. Kdo není administrátor, dostane 404 — z odpovědi nemá
 * být poznat, že tu vůbec něco je.
 */
function jenAdministrator(handler: (ucet: Prihlaseny) => Promise<Response>): Promise<Response> {
  return sRozsahem(async (ucet) => {
    if (!roleJeAdministrator(ucet.role)) return Response.json({ error: 'Nenalezeno' }, { status: 404 })
    return handler(ucet)
  })
}

export async function GET() {
  return jenAdministrator(async (ucet) => Response.json({ skoly: (await seznamSkol(ucet)) ?? [] }))
}

export async function POST(request: Request) {
  return jenAdministrator(async (ucet) => {
    const parsed = zalozitSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })

    const vysledek = await zalozitSkolu(ucet, parsed.data)
    if (!vysledek.ok) return Response.json({ error: vysledek.chyba }, { status: vysledek.status })

    await zapsatAudit({
      schoolId: vysledek.id,
      userId: ucet.userId,
      action: 'skola-zalozena',
      entity: 'school',
      entityId: vysledek.id,
      detail: parsed.data,
    })
    return Response.json({ id: vysledek.id })
  })
}

export async function PATCH(request: Request) {
  return jenAdministrator(async (ucet) => {
    const parsed = upravitSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })

    const { id, ...zmeny } = parsed.data
    const vysledek = await upravitSkolu(ucet, id, zmeny)
    if (!vysledek.ok) return Response.json({ error: vysledek.chyba }, { status: vysledek.status })

    await zapsatAudit({
      schoolId: id,
      userId: ucet.userId,
      action: 'skola-upravena',
      entity: 'school',
      entityId: id,
      detail: zmeny,
    })
    return Response.json({ ok: true })
  })
}
