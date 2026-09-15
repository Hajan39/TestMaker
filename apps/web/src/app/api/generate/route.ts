import { z } from 'zod'
import { AI_QUESTION_TYPES } from '@testmaker/core/schema'
import { isAiConfigured } from '@testmaker/core/ai'
import { DEFAULT_GENERATE_PARAMS, generateForTopic } from '@/lib/generation'

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
    return Response.json({ error: 'AI není nakonfigurovaná (chybí ANTHROPIC_API_KEY nebo ANTHROPIC_AUTH_TOKEN)' }, { status: 503 })
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
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
        send({ type: 'done', ...outcome })
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  })
}
