import { z } from 'zod'
import { aiNotConfiguredMessage, AI_SETTINGS, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { t } from '@testmaker/core/i18n'
import { createGeneratedWorksheet } from '@/lib/tests'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'
export const maxDuration = 120

const S = AI_SETTINGS.worksheet

const brief = {
  /** The teacher's wishes ("více tabulek, na 20 minut"). */
  instructions: z.string().max(S.instructionsMax).default(''),
  /** Own text pasted into the brief — text only, files are never sent to the server. */
  ownText: z.string().max(S.ownTextMax).default(''),
  /** Keep to the supplied text; `false` lets the model add its own examples and knowledge. */
  onlyMaterials: z.boolean().default(true),
}

const bodySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('topic'), topicId: z.string().min(1), ...brief }),
  z.object({
    source: z.literal('free'),
    title: z.string().trim().min(1).max(200),
    gradeId: z.string().min(1).nullable().default(null),
    ...brief,
  }),
])

/**
 * Generates a worksheet with a single model call and saves it with its items.
 * Returns the worksheet id and how many items the model did not return intact.
 */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
      if (!isAiConfigured()) {
        return Response.json(
          { error: `${aiNotConfiguredMessage()} ${t('worksheets:api.createEmptyInstead')}` },
          { status: 503 },
        )
      }
      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json(
          {
            error: t('worksheets:api.briefIncomplete'),
            detail: parsed.error.issues,
          },
          { status: 400 },
        )
      }
      const body = parsed.data
      const source = body.source === 'topic' ? { topicId: body.topicId } : { title: body.title, gradeId: body.gradeId }

      try {
        // Deliberately without `request.signal`: if the teacher closes the page,
        // the worksheet still finishes, is saved and shows up in the overview.
        const result = await createGeneratedWorksheet(account, {
          source,
          instructions: body.instructions.trim(),
          ownText: body.ownText.trim(),
          onlyMaterials: body.onlyMaterials,
        })
        if (!result) return Response.json({ error: t('worksheets:api.topicGone') }, { status: 404 })
        return Response.json(result)
      } catch (error) {
        // The raw error stays in the server log; the teacher gets advice in Czech.
        console.error('Failed to generate worksheet:', error)
        return Response.json({ error: describeAiError(error).message }, { status: 502 })
      }
    },
    { write: true },
  )
}
