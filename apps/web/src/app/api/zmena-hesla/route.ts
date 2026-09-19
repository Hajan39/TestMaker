import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, users } from '@/db'
import { authMode } from '@/lib/session'
import { overitHeslo, zahesovat, zkontrolovatSilu } from '@/lib/heslo'
import {
  odvolatVsechnyRelace,
  sRozsahem,
  zalozitRelaci,
  zapsatAudit,
} from '@/lib/uzivatel'

export const runtime = 'nodejs'

const bodySchema = z.object({
  stare: z.string().min(1).max(200),
  nove: z.string().min(1).max(200),
})

/**
 * Změna vlastního hesla. Chce i to dosavadní: bez něj by stačilo na chvíli
 * odejít od odemčeného počítače a heslo někdo přepíše.
 *
 * Po změně se odvolají všechny relace včetně téhle — a hned se vydá nová,
 * aby uživatelku změna vlastního hesla nevyhodila ven.
 */
export async function POST(request: Request) {
  return sRozsahem(async (ucet) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Vyplň obě hesla.' }, { status: 400 })

    const problem = zkontrolovatSilu(parsed.data.nove)
    if (problem) return Response.json({ error: problem }, { status: 400 })

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, ucet.userId))
      .limit(1)
    if (!row) return Response.json({ error: 'Účet neexistuje' }, { status: 404 })

    if (!(await overitHeslo(parsed.data.stare, row.passwordHash))) {
      return Response.json({ error: 'Dosavadní heslo nesouhlasí.' }, { status: 401 })
    }

    await db
      .update(users)
      .set({ passwordHash: await zahesovat(parsed.data.nove), mustChangePassword: false })
      .where(eq(users.id, ucet.userId))
    await odvolatVsechnyRelace(ucet.userId)
    await zapsatAudit({
      schoolId: ucet.schoolId,
      userId: ucet.userId,
      action: 'zmena-hesla',
    })

    const response = Response.json({ ok: true })
    // Bez zapnutého přihlašování (lokální běh) není co obnovovat — relace
    // tam žádná není a podepsat cookie bez tajemství nejde.
    if (authMode() === 'zapnuto') {
      response.headers.append(
        'set-cookie',
        await zalozitRelaci(ucet.userId, {
          ip: request.headers.get('x-forwarded-for'),
          userAgent: request.headers.get('user-agent'),
        }),
      )
    }
    return response
  })
}
