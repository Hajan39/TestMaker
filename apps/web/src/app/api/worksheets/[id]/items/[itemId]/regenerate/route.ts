import { z } from 'zod'
import { aiNotConfiguredMessage, isAiConfigured } from '@testmaker/core/ai'
import { AI_QUESTION_TYPES } from '@testmaker/core/schema'
import { t } from '@testmaker/core/i18n'
import { regenerateWorksheetPart } from '@/lib/tests'
import { withScope } from '@/lib/user'
import { reportAiFailure } from '@/lib/aiFailure'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['heading', 'instruction', 'text', 'fun_fact', 'table']) }),
    z.object({ kind: z.literal('question'), questionType: z.enum(AI_QUESTION_TYPES) }),
  ]),
  /** Texts of the other worksheet items so the new one does not repeat them. */
  existing: z.array(z.string().max(2_000)).max(60).default([]),
})

/**
 * A new version of one worksheet item. Nothing is stored — the editor swaps it
 * in place and it is saved with the worksheet. `itemId` is only in the URL:
 * even an item that is not saved yet can be regenerated.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  return withScope(
    async (account) => {
      if (!isAiConfigured()) {
        return Response.json({ error: `${aiNotConfiguredMessage()} ${t('worksheets:api.editManually')}` }, { status: 503 })
      }
      const { id } = await params
      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json(
          { error: t('worksheets:api.regenerateInvalid'), detail: parsed.error.issues },
          { status: 400 },
        )
      }
      try {
        const item = await regenerateWorksheetPart(account, id, parsed.data.target, parsed.data.existing, {
          signal: request.signal,
        })
        // Someone else's worksheet behaves as missing.
        if (!item) return Response.json({ error: t('worksheets:api.notFound') }, { status: 404 })
        return Response.json({ item })
      } catch (error) {
        const message = await reportAiFailure(account, { action: 'list-polozka-chyba', entity: 'test', entityId: id, error })
        return Response.json({ error: message }, { status: 502 })
      }
    },
    { write: true },
  )
}
