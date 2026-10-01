import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiNotConfiguredMessage, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { t } from '@testmaker/core/i18n'
import { db, questions } from '@/db'
import { createVariant, isTopicBusy, topicBusyMessage, variantDifficultyLimitMessage } from '@/lib/generation'
import { inSchool, withScope } from '@/lib/user'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({
  id: z.string().min(1),
  direction: z.enum(['easier', 'harder']),
})

/**
 * Creates an easier or harder version of a question on the same content. The
 * original stays unchanged in the bank — the variant is an extra question, not a replacement.
 */
export async function POST(request: Request) {
  return withScope(async (account) => {
    if (!isAiConfigured()) {
      return Response.json({ error: aiNotConfiguredMessage() }, { status: 503 })
    }

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
    }

    const [original] = await db
      .select({ id: questions.id, topicId: questions.topicId, difficulty: questions.difficulty })
      .from(questions)
      .where(and(inSchool(account, questions), eq(questions.id, parsed.data.id)))
      .limit(1)
    if (!original) return Response.json({ error: t('generation:regenerateApi.questionGone') }, { status: 404 })
    if (!original.topicId) {
      return Response.json(
        { error: t('generation:variant.questionWithoutTopic') },
        { status: 409 },
      )
    }

    // Same precedence as for a replacement: the topic's batch generation goes
    // before a single variant so both calls don't work from the same
    // "avoid these questions" list.
    const busy = await isTopicBusy(account, original.topicId)
    if (busy) {
      return Response.json({ error: topicBusyMessage(busy.who) }, { status: 409 })
    }

    // The difficulty limit is reported before the model is even touched —
    // the teacher shouldn't wait for a model answer to a request that can't be met.
    const originalDifficulty = (original.difficulty as 1 | 2 | 3) ?? 2
    const targetDifficulty = originalDifficulty + (parsed.data.direction === 'easier' ? -1 : 1)
    if (targetDifficulty < 1 || targetDifficulty > 3) {
      return Response.json({ error: variantDifficultyLimitMessage(parsed.data.direction) }, { status: 400 })
    }

    try {
      const question = await createVariant(account, parsed.data.id, parsed.data.direction, {
        signal: request.signal,
      })
      return Response.json({ question })
    } catch (error) {
      // Provider messages are English and technical; translate them.
      const { message } = describeAiError(error)
      return Response.json({ error: message }, { status: 502 })
    }
  }, { write: true })
}
