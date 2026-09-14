import { and, asc, eq } from 'drizzle-orm'
import { isAiConfigured } from '@testmaker/core/ai'
import { db, generationJobs } from '@/db'
import { generateForMaterial } from '@/lib/generation'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Zpracuje jednu úlohu z fronty. UI volá endpoint ve smyčce, dokud vrací
 * `remaining > 0` — díky tomu se vejdeme do časového limitu funkce i na Vercelu.
 */
export async function POST() {
  if (!isAiConfigured()) {
    return Response.json({ error: 'AI není nakonfigurovaná' }, { status: 503 })
  }

  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.status, 'queued'))
    .orderBy(asc(generationJobs.createdAt))
    .limit(1)

  if (!job) return Response.json({ processed: false, remaining: 0 })

  // Označíme jako běžící; pokud to nevyjde, úlohu si vzal jiný běh.
  const claimed = await db
    .update(generationJobs)
    .set({ status: 'running', startedAt: new Date().toISOString() })
    .where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, 'queued')))
    .returning({ id: generationJobs.id })

  if (claimed.length === 0) return Response.json({ processed: false, remaining: await remaining() })

  try {
    const outcome = await generateForMaterial(job.materialId, job.params)
    await db
      .update(generationJobs)
      .set({
        status: 'done',
        producedCount: outcome.created,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(generationJobs.id, job.id))
    return Response.json({
      processed: true,
      jobId: job.id,
      created: outcome.created,
      remaining: await remaining(),
    })
  } catch (error) {
    await db
      .update(generationJobs)
      .set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      })
      .where(eq(generationJobs.id, job.id))
    return Response.json({
      processed: true,
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
      remaining: await remaining(),
    })
  }
}

async function remaining(): Promise<number> {
  const rows = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(eq(generationJobs.status, 'queued'))
  return rows.length
}
