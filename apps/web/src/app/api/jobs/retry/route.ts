import { z } from 'zod'
import { retryFailedJobs } from '@/lib/jobs'
import { withScope } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

const bodySchema = z.object({
  /** Which unfinished jobs to retry; without them all are retried. */
  ids: z.array(z.string().min(1)).optional(),
})

/**
 * Puts unfinished topics back into the queue.
 *
 * The most common cause of a stop is an exhausted daily model quota — the next
 * day it's enough to retry just what didn't get done, not regenerate the whole grade.
 */
export async function POST(request: Request) {
  return withScope(async (account) => {
  // The body is optional: "retry everything" is sent without one.
  const raw = (await request.text()).trim()
  let body: unknown = {}
  try {
    if (raw) body = JSON.parse(raw)
  } catch {
    return Response.json({ error: t('api:invalidRequest') }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
  }

  const requeued = await retryFailedJobs(account, parsed.data.ids)
  return Response.json({ ok: true, requeued })
  }, { write: true })
}
