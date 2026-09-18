import { z } from 'zod'
import { retryFailedJobs } from '@/lib/jobs'

export const runtime = 'nodejs'

const bodySchema = z.object({
  /** Které nedokončené úlohy zkusit znovu; bez nich se zkusí všechny. */
  ids: z.array(z.string().min(1)).optional(),
})

/**
 * Zařadí nedokončená témata znovu mezi čekající.
 *
 * Nejčastější příčinou zastavení je vyčerpaný denní limit modelu — druhý den
 * stačí zkusit znovu právě to, co se nestihlo, a ne generovat celý ročník
 * odznova.
 */
export async function POST(request: Request) {
  // Tělo je nepovinné: „zkusit znovu všechno“ se posílá bez něj.
  const raw = (await request.text()).trim()
  let body: unknown = {}
  try {
    if (raw) body = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'Neplatná data' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  const requeued = await retryFailedJobs(parsed.data.ids)
  return Response.json({ ok: true, requeued })
}
