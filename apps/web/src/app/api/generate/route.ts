import { z } from 'zod'
import { AI_QUESTION_TYPES } from '@testmaker/core/schema'
import { isAiConfigured } from '@testmaker/core/ai'
import { claimTopic, DEFAULT_GENERATE_PARAMS, generateForTopic, releaseTopic } from '@/lib/generation'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  topicId: z.string().min(1),
  count: z.number().int().min(1).max(60).default(DEFAULT_GENERATE_PARAMS.count),
  types: z.array(z.enum(AI_QUESTION_TYPES)).min(1).default([...AI_QUESTION_TYPES]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('mix')]).default('mix'),
})

/** Streamuje průběh generování jako text, aby UI vidělo postup u dlouhých materiálů. */
export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return Response.json({ error: 'AI není nakonfigurovaná — doplň ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN nebo GOOGLE_GENERATIVE_AI_API_KEY' }, { status: 503 })
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  // Rezervace tématu: dvě generování naráz nad týmž tématem by o sobě nevěděla
  // a vyrobila by tytéž otázky dvakrát.
  const jobId = await claimTopic(parsed.data.topicId)
  if (!jobId) {
    return Response.json(
      { error: 'Pro tohle téma už generování běží. Počkej, než doběhne.' },
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
          parsed.data.topicId,
          {
            count: parsed.data.count,
            types: parsed.data.types,
            difficulty: parsed.data.difficulty,
          },
          {
            signal: request.signal,
            onProgress: (done, total) => send({ type: 'progress', done, total }),
          },
        )
        await releaseTopic(jobId, { created: outcome.created })
        send({ type: 'done', ...outcome })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await releaseTopic(jobId, { error: message })
        send({ type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  })
}
