import { z } from 'zod'
import { aiNotConfiguredMessage, completeQuestionAnswers, isAiConfigured } from '@testmaker/core/ai'
import { t } from '@testmaker/core/i18n'
import { QUESTION_TYPES } from '@testmaker/core/schema'
import { callRecorder } from '@/lib/aiUsage'
import { reportAiFailure } from '@/lib/aiFailure'
import { loadTopicSource } from '@/lib/generation'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'
export const maxDuration = 120

const COMPLETABLE = QUESTION_TYPES.filter((type) => type !== 'label_image') as [
  Exclude<(typeof QUESTION_TYPES)[number], 'label_image'>,
  ...Exclude<(typeof QUESTION_TYPES)[number], 'label_image'>[],
]

const bodySchema = z.object({
  /** Empty for a question outside a topic (a worksheet from a free brief) — then there are no materials. */
  topicId: z.string().optional(),
  question: z.object({
    type: z.enum(COMPLETABLE),
    payload: z.record(z.string(), z.unknown()),
    explanation: z.string().optional(),
    points: z.number().optional(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  }),
  /** Step two: the teacher confirmed that general knowledge may be used. */
  allowGeneralKnowledge: z.boolean().default(false),
})

/**
 * Completes the missing answers of the teacher's own question via the model.
 * Saves nothing — the editor shows the values and the teacher saves as usual.
 * Step one keeps to the topic's materials and answers `not_found` when the
 * answer is not there; only step two may use general knowledge.
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
    const { topicId, question, allowGeneralKnowledge } = parsed.data

    let source: Awaited<ReturnType<typeof loadTopicSource>> = null
    if (topicId) {
      source = await loadTopicSource(account, topicId)
      // A foreign topic looks nonexistent.
      if (!source) return Response.json({ error: t('library:topicsApi.topicGone') }, { status: 404 })
    }

    try {
      const result = await completeQuestionAnswers(
        {
          draft: question,
          topicName: source?.topicName ?? null,
          subjectName: source?.subjectName ?? null,
          gradeName: source?.gradeName || null,
          materials: source?.text ?? '',
          allowGeneralKnowledge,
        },
        { signal: request.signal, onCall: callRecorder(account, 'otazky') },
      )
      return Response.json(result)
    } catch (error) {
      const message = await reportAiFailure(account, { action: 'doplneni-odpovedi-chyba', entity: 'topic', entityId: topicId ?? null, error })
      return Response.json({ error: message }, { status: 502 })
    }
  }, { write: true })
}
