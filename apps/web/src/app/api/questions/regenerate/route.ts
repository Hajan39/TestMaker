import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiNotConfiguredMessage, isAiConfigured } from '@testmaker/core/ai'
import { t } from '@testmaker/core/i18n'
import { REGENERATE_REASONS, type RegenerateReason } from '@testmaker/core/schema'
import { db, questions } from '@/db'
import { isTopicBusy, regenerateQuestion, topicBusyMessage } from '@/lib/generation'
import { inSchool, withScope } from '@/lib/user'
import { reportAiFailure } from '@/lib/aiFailure'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({
  id: z.string().min(1),
  /** Why the question is replaced — optional, one-click regeneration works unchanged. */
  reason: z.enum(Object.keys(REGENERATE_REASONS) as [string, ...string[]]).optional(),
  /** The teacher's own note on top of the reason. */
  note: z.string().max(1000).optional(),
})

/**
 * Is model replacement available at all? The UI hides the button accordingly
 * instead of offering it and then failing on a missing key.
 */
export function GET() {
  return Response.json({ configured: isAiConfigured() })
}

/**
 * Replaces one question via the model: a new question of the same type and
 * difficulty is generated from the same materials, and only then is the
 * original marked rejected. When the model fails, nothing changes in the
 * database and a user-facing message is returned — for the teacher it means
 * nothing happened and she can try again.
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
  // A note without a reason has nowhere to go — in the prompt the "why the
  // question is replaced" sentence only hangs off a chosen reason; a bare note makes no sense.
  if (parsed.data.note && !parsed.data.reason) {
    return Response.json({ error: t('generation:regenerateApi.noteNeedsReason') }, { status: 400 })
  }

  const [original] = await db
    .select({ id: questions.id, topicId: questions.topicId })
    .from(questions)
    .where(and(inSchool(account, questions), eq(questions.id, parsed.data.id)))
    .limit(1)
  if (!original) return Response.json({ error: t('generation:regenerateApi.questionGone') }, { status: 404 })
  if (!original.topicId) {
    return Response.json(
      { error: t('generation:generation.questionWithoutTopic') },
      { status: 409 },
    )
  }

  // The topic isn't claimed (`claimTopic`) — one question would block the whole
  // topic. A running batch generation still takes precedence, because both calls
  // would otherwise work from the same "avoid these questions" list.
  const busy = await isTopicBusy(account, original.topicId)
  if (busy) {
    return Response.json({ error: topicBusyMessage(busy.who) }, { status: 409 })
  }

  try {
    const question = await regenerateQuestion(account, parsed.data.id, {
      signal: request.signal,
      reason: parsed.data.reason as RegenerateReason | undefined,
      note: parsed.data.note,
    })
    return Response.json({ question })
  } catch (error) {
    // Provider messages are English and technical; translate them.
    const message = await reportAiFailure(account, { action: 'nahrazeni-chyba', entity: 'question', entityId: parsed.data.id, error })
    return Response.json({ error: message }, { status: 502 })
  }
  }, { write: true })
}
