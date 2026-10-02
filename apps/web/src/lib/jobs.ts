import 'server-only'
import { and, asc, count, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { AI_SETTINGS } from '@testmaker/core/ai'
import { t } from '@testmaker/core/i18n'
import { db, generationJobs, grades, subjects, topics, users } from '@/db'
import { canManage, inSchool, writeAudit, type Scope } from './user'
import { isoAgo } from '@testmaker/core/dates'

/**
 * Generation queue for the overview. The screen and the toolbar indicator read
 * the same thing: what runs, what waits, what is done and what failed. The
 * `generation_jobs` table knows all of it — it just wasn't shown anywhere and
 * the teacher had no way to tell that something got stuck.
 */

export type JobState = 'queued' | 'running' | 'done' | 'error'

export interface QueueCounts {
  queued: number
  running: number
  done: number
  error: number
  /**
   * Topic of the only running or queued job, when nothing failed. The toolbar
   * indicator replaces the generic overview link with it — with one topic it
   * can lead straight there.
   */
  topicId?: string
}

export interface QueueJob {
  id: string
  topicId: string
  topicName: string
  /** Subject and grade, so it's clear which library topic this is. */
  place: string
  status: JobState
  /** How many questions were requested — for queued jobs that's all we can say. */
  wanted: number | null
  createdCount: number
  /** Name of the person who requested the job. */
  requestedByName: string
  /** Is the job mine? Decides whether the overview offers retry and delete. */
  mine: boolean
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** How many finished jobs are listed. Older ones interest nobody. */
export const DONE_LIMIT = 20

/**
 * Jobs that have been "running" for too long were cut off by the server and
 * never recorded their end — they would spin in the toolbar forever and keep
 * their topic locked (`claimTopic`). A direct generation is marked as failed
 * (the teacher may retry it from the overview); a queue job goes back to the
 * queue. Called wherever the queue is read or a topic claimed, so it needs no
 * scheduler; without a scope (the queue runner) it covers all schools.
 *
 * Claims from before the `direct` flag are recognised by starting the moment
 * they were created — a queue job waits in the queue first.
 */
export async function expireStaleJobs(scope: Scope | null): Promise<{ failed: number; requeued: number }> {
  const cutoff = isoAgo(AI_SETTINGS.staleJobMinutes, 'minute')
  const stale = and(
    scope ? inSchool(scope, generationJobs) : undefined,
    eq(generationJobs.status, 'running'),
    or(lt(generationJobs.startedAt, cutoff), sql`${generationJobs.startedAt} is null`),
  )
  const direct = sql`(json_extract(${generationJobs.params}, '$.direct') = 1
    or abs(julianday(${generationJobs.startedAt}) - julianday(${generationJobs.createdAt})) * 86400 < 2)`

  const failed = await db
    .update(generationJobs)
    .set({ status: 'error', error: t('generation:generation.interrupted'), finishedAt: new Date().toISOString() })
    .where(and(stale, direct))
    .returning({
      id: generationJobs.id,
      schoolId: generationJobs.schoolId,
      topicId: generationJobs.topicId,
      requestedBy: generationJobs.requestedBy,
    })
  for (const job of failed) {
    await writeAudit({
      schoolId: job.schoolId,
      userId: job.requestedBy,
      action: 'fronta-prerusena',
      entity: 'topic',
      entityId: job.topicId,
      detail: {
        message: t('generation:generation.interrupted'),
        technicky: `job ${job.id}: "running" for over ${AI_SETTINGS.staleJobMinutes} min, the request limit is 300 s`,
      },
      severity: 'chyba',
    })
  }

  const requeued = await db
    .update(generationJobs)
    .set({ status: 'queued', startedAt: null })
    .where(stale)
    .returning({ id: generationJobs.id })

  return { failed: failed.length, requeued: requeued.length }
}

/** Counts per state — a cheap query for the toolbar indicator. */
export async function countJobs(scope: Scope): Promise<QueueCounts> {
  await expireStaleJobs(scope)
  const rows = await db
    .select({ status: generationJobs.status, value: count() })
    .from(generationJobs)
    .where(inSchool(scope, generationJobs))
    .groupBy(generationJobs.status)

  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.value]))
  const counts: QueueCounts = {
    queued: byStatus.queued ?? 0,
    running: byStatus.running ?? 0,
    done: byStatus.done ?? 0,
    error: byStatus.error ?? 0,
  }

  // Exactly one unfinished job and no failures: the toolbar indicator can lead
  // straight to its topic instead of the generic overview.
  if (counts.queued + counts.running === 1 && counts.error === 0) {
    const [solo] = await db
      .select({ topicId: generationJobs.topicId })
      .from(generationJobs)
      .where(and(inSchool(scope, generationJobs), inArray(generationJobs.status, ['queued', 'running'])))
      .limit(1)
    if (solo) counts.topicId = solo.topicId
  }

  return counts
}

/**
 * Jobs for the overview: everything unfinished plus the last few finished ones.
 * Ordered the way it's read — running, queued, failed, done.
 */
export async function loadJobs(scope: Scope): Promise<QueueJob[]> {
  await expireStaleJobs(scope)
  const rows = await db
    .select({
      id: generationJobs.id,
      topicId: generationJobs.topicId,
      topicName: topics.name,
      gradeName: grades.name,
      subjectName: subjects.name,
      /** Who requested the job — otherwise nobody knows who holds a blocked topic. */
      requestedByName: users.name,
      requestedBy: generationJobs.requestedBy,
      status: generationJobs.status,
      params: generationJobs.params,
      producedCount: generationJobs.producedCount,
      error: generationJobs.error,
      createdAt: generationJobs.createdAt,
      startedAt: generationJobs.startedAt,
      finishedAt: generationJobs.finishedAt,
    })
    .from(generationJobs)
    .innerJoin(topics, eq(topics.id, generationJobs.topicId))
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .innerJoin(users, eq(users.id, generationJobs.requestedBy))
    .where(
      and(
      inSchool(scope, generationJobs),
      or(
        inArray(generationJobs.status, ['queued', 'running', 'error']),
        // Only the last few finished: after bulk generation there are hundreds
        // and the overview would become an endless list.
        sql`${generationJobs.id} in (
          select id from ${generationJobs}
          where status = 'done'
          order by coalesce(finished_at, created_at) desc
          limit ${DONE_LIMIT}
        )`,
      ),
      ),
    )
    .orderBy(
      // State order: running, queued, failed, done.
      sql`case ${generationJobs.status} when 'running' then 0 when 'queued' then 1 when 'error' then 2 else 3 end`,
      asc(generationJobs.createdAt),
    )

  return rows.map((row) => ({
    id: row.id,
    topicId: row.topicId,
    topicName: row.topicName,
    place: [row.subjectName, row.gradeName].filter(Boolean).join(' · '),
    requestedByName: row.requestedByName,
    mine: row.requestedBy === scope.userId,
    status: row.status,
    wanted: typeof row.params?.count === 'number' ? row.params.count : null,
    createdCount: row.producedCount,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  }))
}

/**
 * Puts unfinished jobs back into the queue. Without it, after a model quota ran
 * out the only option would be to enqueue the whole range again and regenerate
 * what is already done.
 *
 * Only own jobs can be retried; an admin also others', to clean up after someone.
 */
export async function retryFailedJobs(scope: Scope, ids?: string[]): Promise<number> {
  const target = and(
    inSchool(scope, generationJobs),
    canManage(scope) ? undefined : eq(generationJobs.requestedBy, scope.userId),
    eq(generationJobs.status, 'error'),
    ids?.length ? inArray(generationJobs.id, ids) : undefined,
  )

  const failed = await db
    .select({ id: generationJobs.id, topicId: generationJobs.topicId })
    .from(generationJobs)
    .where(target)
  if (failed.length === 0) return 0

  // A topic that is running or queued again meanwhile isn't enqueued twice —
  // two runs over the same topic don't know about each other and would produce the same questions.
  const busy = await db
    .select({ topicId: generationJobs.topicId })
    .from(generationJobs)
    .where(
      and(
        inSchool(scope, generationJobs),
        inArray(generationJobs.topicId, failed.map((row) => row.topicId)),
        inArray(generationJobs.status, ['queued', 'running']),
      ),
    )
  const blocked = new Set(busy.map((row) => row.topicId))
  const toRetry = failed.filter((row) => !blocked.has(row.topicId)).map((row) => row.id)
  if (toRetry.length === 0) return 0

  await db
    .update(generationJobs)
    .set({ status: 'queued', error: null, startedAt: null, finishedAt: null, producedCount: 0 })
    .where(inArray(generationJobs.id, toRetry))
  return toRetry.length
}

/**
 * Empties the queue.
 *
 * `cekajici` (default) also drops running jobs: after an interrupted run they
 * stay hanging and their topic could only be unblocked by editing the database.
 * `vse` additionally deletes the list of finished jobs when the teacher wants it cleaned up.
 */
export async function clearJobs(
  scope: Scope,
  mode: 'cekajici' | 'vse' = 'cekajici',
): Promise<number> {
  const removed = await db
    .delete(generationJobs)
    .where(
      and(
        inSchool(scope, generationJobs),
        // Only an admin may clear other people's queue.
        canManage(scope) ? undefined : eq(generationJobs.requestedBy, scope.userId),
        mode === 'vse' ? undefined : inArray(generationJobs.status, ['queued', 'error', 'running']),
      ),
    )
    .returning({ id: generationJobs.id })
  return removed.length
}
