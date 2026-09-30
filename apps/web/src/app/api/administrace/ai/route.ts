import { obdobiZ, prehledPouzitiAi } from '@/lib/aiUsage'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/**
 * Přehled použití AI za období (`?dni=7|30|90`, výchozí 30). Kdo není
 * administrátor, dostane 404 — z odpovědi nemá být poznat, že tu něco je.
 */
export async function GET(request: Request) {
  return sRozsahem(async (ucet) => {
    const prehled = await prehledPouzitiAi(ucet, obdobiZ(new URL(request.url).searchParams.get('dni')))
    if (!prehled) return Response.json({ error: 'Nenalezeno' }, { status: 404 })
    return Response.json(prehled)
  })
}
