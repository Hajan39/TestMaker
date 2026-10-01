import { z } from 'zod'
import { aiNotConfiguredMessage, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { createTestVariant } from '@/lib/testVariant'
import { loadTest } from '@/lib/tests'
import { t } from '@testmaker/core/i18n'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  testId: z.string().min(1),
  direction: z.enum(['easier', 'harder']),
})

/**
 * Streams the creation of an easier or harder version of a whole test (NDJSON,
 * same shape as `/api/generate`): `start { total, testId }`, `progress { done, total }`,
 * `done { testId, replaced, generated, kept }`, `error { message }`.
 *
 * `testId` is already sent in `start`: at `maxDuration` the platform may kill
 * the function midway and `done` never arrives. The client can then still find
 * the copy and open it with a note that it is only partly done — otherwise it
 * would be silently orphaned.
 *
 * The copy is only created once the preliminary checks pass (model configured,
 * source test visible) — only then does the stream start, so errors are
 * reported as a plain response, not midway.
 */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
      if (!isAiConfigured()) {
        return Response.json({ error: aiNotConfiguredMessage() }, { status: 503 })
      }

      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json(
          { error: t('tests:api.variantInvalid'), detail: parsed.error.issues },
          { status: 400 },
        )
      }

      const source = await loadTest(account, parsed.data.testId)
      if (!source) return Response.json({ error: t('tests:api.testNotFoundShort') }, { status: 404 })

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          // A cancelled request (the teacher closed the page, the browser
          // navigated away) closes `controller` too — `enqueue`/`close` then
          // throw because there is nowhere to write, not because the stream failed.
          const send = (event: Record<string, unknown>) => {
            try {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
            } catch {
              // The stream is gone; no point writing to it.
            }
          }

          try {
            // Deliberately without `request.signal` (as with worksheet generation):
            // leaving the page would cut the variant short and leave a half-done
            // copy. The server finishes it anyway; it shows up in the test overview.
            const outcome = await createTestVariant(account, parsed.data.testId, parsed.data.direction, {
              onStart: (total, testId) => send({ type: 'start', total, testId }),
              onProgress: (done, total) => send({ type: 'progress', done, total }),
            })
            send({ type: 'done', ...outcome })
          } catch (error) {
            // Provider messages are English and technical; we translate them.
            const { message } = describeAiError(error)
            send({ type: 'error', message })
          } finally {
            try {
              controller.close()
            } catch {
              // A cancelled stream can't be closed twice — already closed is fine too.
            }
          }
        },
      })

      return new Response(stream, {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
      })
    },
    { write: true },
  )
}
