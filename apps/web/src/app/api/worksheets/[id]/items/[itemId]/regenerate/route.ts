import { z } from 'zod'
import { AI_NOT_CONFIGURED_MESSAGE, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { AI_QUESTION_TYPES } from '@testmaker/core/schema'
import { regenerateWorksheetPart } from '@/lib/tests'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['heading', 'instruction', 'text', 'fun_fact', 'table']) }),
    z.object({ kind: z.literal('question'), questionType: z.enum(AI_QUESTION_TYPES) }),
  ]),
  /** Texty ostatních položek listu, aby se nová neopakovala. */
  existing: z.array(z.string().max(2_000)).max(60).default([]),
})

/**
 * Nová podoba jednoho kusu listu. Položka se nikam neukládá — editor ji
 * vymění na tomtéž místě a uloží se s listem. `itemId` je jen v adrese:
 * přegenerovat jde i kus, který ještě není uložený.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  return sRozsahem(
    async (ucet) => {
      if (!isAiConfigured()) {
        return Response.json({ error: `${AI_NOT_CONFIGURED_MESSAGE} Položku můžeš upravit ručně.` }, { status: 503 })
      }
      const { id } = await params
      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json(
          { error: 'Položku se nepodařilo přegenerovat. Obnov stránku a zkus to znovu.', detail: parsed.error.issues },
          { status: 400 },
        )
      }
      try {
        const item = await regenerateWorksheetPart(ucet, id, parsed.data.target, parsed.data.existing, {
          signal: request.signal,
        })
        // Cizí list se tváří jako neexistující.
        if (!item) return Response.json({ error: 'Pracovní list se nenašel' }, { status: 404 })
        return Response.json({ item })
      } catch (error) {
        console.error('Položku listu se nepodařilo přegenerovat:', error)
        return Response.json({ error: describeAiError(error).message }, { status: 502 })
      }
    },
    { zapis: true },
  )
}
