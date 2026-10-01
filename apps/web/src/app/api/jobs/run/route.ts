import { and, asc, eq, lt, or, sql } from 'drizzle-orm'
import { aiNotConfiguredMessage, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { db, generationJobs } from '@/db'
import { callRecorder } from '@/lib/aiUsage'
import { generateForTopic } from '@/lib/generation'
import { scopeFromJob, writeAudit } from '@/lib/user'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * How long a job may run before we consider it abandoned. Generating one topic
 * takes tens of seconds; when the window driving the queue closes, the job stays
 * hanging and without this limit would block the topic forever.
 */
const ABANDONED_AFTER_MS = 15 * 60 * 1000

/** Puts abandoned running jobs back into the queue. */
async function reviveAbandoned(): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDONED_AFTER_MS).toISOString()
  const revived = await db
    .update(generationJobs)
    .set({ status: 'queued', startedAt: null })
    .where(
      and(
        eq(generationJobs.status, 'running'),
        or(lt(generationJobs.startedAt, cutoff), sql`${generationJobs.startedAt} is null`),
      ),
    )
    .returning({ id: generationJobs.id })
  return revived.length
}

/**
 * Processes one job from the queue. The UI calls the endpoint in a loop while it
 * returns `remaining > 0` — that keeps us within the function time limit on Vercel too.
 */
export async function POST() {
  return runOne()
}

/** The same for a scheduler (Vercel Cron, cron on Synology). The middleware lets it in via CRON_SECRET. */
export async function GET() {
  return runOne()
}

async function runOne() {
  if (!isAiConfigured()) {
    return Response.json({ error: aiNotConfiguredMessage() }, { status: 503 })
  }

  // First collect what an interrupted run left behind.
  const revived = await reviveAbandoned()

  /*
   * Which job is next. Not simply the oldest in the whole queue: whoever
   * enqueues a whole grade should delay others by one job, not by an hour.
   * So a requester with nothing running goes first, and only then does job age decide.
   */
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.status, 'queued'))
    .orderBy(
      sql`(select count(*) from ${generationJobs} active
            where active.requested_by = ${generationJobs.requestedBy} and active.status = 'running')`,
      asc(generationJobs.createdAt),
    )
    .limit(1)

  if (!job) return Response.json({ processed: false, remaining: 0, revived })

  // Mark as running; if that fails, another run took the job.
  const claimed = await db
    .update(generationJobs)
    .set({ status: 'running', startedAt: new Date().toISOString() })
    .where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, 'queued')))
    .returning({ id: generationJobs.id })

  if (claimed.length === 0) return Response.json({ processed: false, remaining: await remaining() })

  try {
    const outcome = await generateForTopic(scopeFromJob(job), job.topicId, job.params, {
      // The queue runs without a signed-in person — no user in the AI usage overview.
      onCall: callRecorder({ schoolId: job.schoolId, userId: null }, 'otazky'),
    })
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
    // The queue stores the user-facing message — the teacher sees it on the stopped job.
    const { message } = describeAiError(error)
    await db
      .update(generationJobs)
      .set({ status: 'error', error: message, finishedAt: new Date().toISOString() })
      .where(eq(generationJobs.id, job.id))
    await writeAudit({
      schoolId: job.schoolId,
      userId: job.requestedBy,
      action: 'fronta-chyba',
      entity: 'topic',
      entityId: job.topicId,
      detail: { message },
      severity: 'chyba',
    })
    return Response.json({
      processed: true,
      jobId: job.id,
      error: message,
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
