import { z } from 'zod'
import { AI_QUESTION_TYPES } from '@testmaker/core/schema'
import { aiNotConfiguredMessage, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { t } from '@testmaker/core/i18n'
import { claimTopic, DEFAULT_GENERATE_PARAMS, generateForTopic, releaseTopic } from '@/lib/generation'
import { withScope, writeAudit } from '@/lib/user'
import { technicalDetail } from '@/lib/aiFailure'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  topicId: z.string().min(1),
  count: z.number().int().min(1).max(60).default(DEFAULT_GENERATE_PARAMS.count),
  types: z.array(z.enum(AI_QUESTION_TYPES)).min(1).default([...AI_QUESTION_TYPES]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('mix')]).default('mix'),
  /** `add` = create `count` new ones, `target` = top the topic up to `count`. */
  mode: z.enum(['add', 'target']).default('add'),
})

/** Streams generation progress as text so the UI sees progress on long materials. */
export async function POST(request: Request) {
  return withScope(async (account) => {
  if (!isAiConfigured()) {
    return Response.json({ error: aiNotConfiguredMessage() }, { status: 503 })
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
  }

  // Claim the topic: two simultaneous generations over one topic wouldn't know
  // about each other and would produce the same questions twice.
  const jobId = await claimTopic(account, parsed.data.topicId)
  if (!jobId) {
    return Response.json(
      { error: t('generation:generateApi.alreadyRunning') },
      { status: 409 },
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))

      try {
        send({ type: 'start' })
        const outcome = await generateForTopic(
          account,
          parsed.data.topicId,
          {
            count: parsed.data.count,
            types: parsed.data.types,
            difficulty: parsed.data.difficulty,
            mode: parsed.data.mode,
          },
          {
            signal: request.signal,
            onProgress: (done, total) => send({ type: 'progress', done, total }),
            // After each saved batch: how many questions are done and which.
            // Without it a long material shows only a spinner for ten minutes
            // and nothing hints that work is really progressing.
            onSaved: ({ created, questions }) => send({ type: 'saved', created, questions }),
          },
        )
        await releaseTopic(jobId, { created: outcome.created })
        send({ type: 'done', ...outcome })
      } catch (error) {
        // Provider messages are English and technical; translate them.
        const { message } = describeAiError(error)
        await releaseTopic(jobId, { error: message })
        await writeAudit({
          schoolId: account.schoolId,
          userId: account.userId,
          action: 'generovani-chyba',
          entity: 'topic',
          entityId: parsed.data.topicId,
          detail: { message, technicky: technicalDetail(error) },
          severity: 'chyba',
        })
        send({ type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  })
  }, { write: true })
}
