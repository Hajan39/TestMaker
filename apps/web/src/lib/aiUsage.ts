import 'server-only'
import { count, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { listAiModels, type AiCallEvent, type AiCallListener } from '@testmaker/core/ai'
import { aiCalls, db, schools, type AiCallRow } from '@/db'
import { newId } from '@/lib/ids'
import { isAdministratorRole } from '@/lib/role'
import type { Scope } from '@/lib/user'

/**
 * AI usage: every attempt to call a model is written to `ai_calls` and the
 * administrator sees the traffic from it — which model is actually called, how many
 * tokens it used and how often it hit a limit. Nothing is configured here;
 * the model ladder is still set only by `AI_MODELS`.
 */

export type AiTask = AiCallRow['task']

/** Tasks in the order the overview shows them. */
export const AI_TASKS: readonly AiTask[] = ['otazky', 'hlavolam', 'list']

/** Who started the generation. The queue and the scheduler have nobody signed in (`userId: null`). */
export interface Caller {
  schoolId: string
  userId: string | null
}

export const PERIOD_DAYS = [7, 30, 90] as const
export type PeriodDays = (typeof PERIOD_DAYS)[number]
const DEFAULT_PERIOD: PeriodDays = 30

/** Period from the URL (`?dni=`); anything other than 7, 30 or 90 means the default 30. */
export function periodFrom(value: unknown): PeriodDays {
  const days = Number(value)
  return (PERIOD_DAYS as readonly number[]).includes(days) ? (days as PeriodDays) : DEFAULT_PERIOD
}

const DAY_MS = 24 * 60 * 60 * 1000
/** How long records are kept — over a year, so the same period last year can be compared. */
const RETENTION_DAYS = 400
/** Clean up old records roughly once per this many writes. */
const CLEANUP_EVERY = 500

/**
 * Records one call attempt. Never throws: a traffic record must not bring
 * down the generation it describes.
 */
export async function recordCall(who: Caller, task: AiTask, event: AiCallEvent): Promise<void> {
  try {
    await db.insert(aiCalls).values({
      id: newId(),
      schoolId: who.schoolId,
      userId: who.userId,
      task,
      model: event.model,
      outcome: event.outcome,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      durationMs: Math.round(event.durationMs),
    })
    // ponytail: cleanup on write (randomly once per ~500 writes); a cron job once it is needed.
    if (Math.random() < 1 / CLEANUP_EVERY) await cleanupOldCalls()
  } catch (error) {
    console.error('Failed to store the model call record:', error)
  }
}

/**
 * Listener for `startLadder` (via `onCall` in the core generators). The write
 * runs in the background — generation does not wait for the database.
 */
export function callRecorder(who: Caller, task: AiTask): AiCallListener {
  const caller: Caller = { schoolId: who.schoolId, userId: who.userId }
  return (event) => {
    void recordCall(caller, task, event)
  }
}

/** Deletes records older than 400 days; returns how many there were. */
export async function cleanupOldCalls(now: number = Date.now()): Promise<number> {
  const cutoffDate = new Date(now - RETENTION_DAYS * DAY_MS).toISOString()
  const deleted = await db.delete(aiCalls).where(lt(aiCalls.createdAt, cutoffDate)).returning({ id: aiCalls.id })
  return deleted.length
}

export interface ModelUsage {
  model: string
  calls: number
  ok: number
  limit: number
  badShape: number
  error: number
  input: number
  output: number
  /** Time of the last call (ISO). */
  lastAt: string
}

export interface TaskUsage {
  task: AiTask
  calls: number
  input: number
  output: number
}

export interface SchoolUsage {
  schoolId: string
  name: string
  calls: number
  input: number
  output: number
}

export interface UsageDay {
  /** `YYYY-MM-DD` in UTC, same as `created_at`. */
  day: string
  ok: number
  limit: number
  /** Unusable responses and errors. */
  others: number
}

export interface AiUsageOverview {
  days: PeriodDays
  total: number
  /** The ladder as currently configured, including models without a key. */
  ladder: { model: string; hasKey: boolean }[]
  models: ModelUsage[]
  /** Always all three tasks in a fixed order. */
  tasks: TaskUsage[]
  schools: SchoolUsage[]
  /** Exactly `days` days, from the oldest to today, including those without calls. */
  dayRows: UsageDay[]
}

const outcomeCount = (outcome: AiCallRow['outcome']) =>
  sql<number>`coalesce(sum(case when ${aiCalls.outcome} = ${outcome} then 1 else 0 end), 0)`.mapWith(Number)
const input = () => sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)`.mapWith(Number)
const output = () => sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)`.mapWith(Number)

/**
 * AI usage overview for the last `days` days (including today) for
 * administration. Any role other than administrator gets `null` — the page and the API
 * then pretend not to exist.
 *
 * A deliberate exception to the "one query, one school" rule: the administrator
 * sees across schools here. The query returns only aggregates (counts and tokens), no content.
 */
export async function aiUsageOverview(
  scope: Scope,
  days: PeriodDays,
  options: { now?: number } = {},
): Promise<AiUsageOverview | null> {
  if (!isAdministratorRole(scope.role)) return null
  const now = options.now ?? Date.now()

  const periodDays = Array.from({ length: days }, (_, i) =>
    new Date(now - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  )
  const inPeriod = gte(aiCalls.createdAt, `${periodDays[0]}T00:00:00.000Z`)
  const day = sql<string>`substr(${aiCalls.createdAt}, 1, 10)`

  const [models, tasks, schoolRows, dayRows] = await Promise.all([
    db
      .select({
        model: aiCalls.model,
        calls: count(),
        ok: outcomeCount('ok'),
        limit: outcomeCount('limit'),
        badShape: outcomeCount('bad_shape'),
        error: outcomeCount('error'),
        input: input(),
        output: output(),
        lastAt: sql<string>`max(${aiCalls.createdAt})`,
      })
      .from(aiCalls)
      .where(inPeriod)
      .groupBy(aiCalls.model)
      .orderBy(desc(count()), aiCalls.model),
    db
      .select({ task: aiCalls.task, calls: count(), input: input(), output: output() })
      .from(aiCalls)
      .where(inPeriod)
      .groupBy(aiCalls.task),
    db
      .select({ schoolId: aiCalls.schoolId, name: schools.name, calls: count(), input: input(), output: output() })
      .from(aiCalls)
      .innerJoin(schools, eq(schools.id, aiCalls.schoolId))
      .where(inPeriod)
      .groupBy(aiCalls.schoolId)
      .orderBy(desc(count()), schools.name),
    db
      .select({ day, calls: count(), ok: outcomeCount('ok'), limit: outcomeCount('limit') })
      .from(aiCalls)
      .where(inPeriod)
      .groupBy(day),
  ])

  const byDay = new Map(dayRows.map((row) => [row.day, row]))
  const byTask = new Map(tasks.map((row) => [row.task, row]))

  return {
    days,
    total: models.reduce((sum, row) => sum + row.calls, 0),
    ladder: listAiModels().map(({ model, hasKey }) => ({ model, hasKey: hasKey })),
    models,
    tasks: AI_TASKS.map((task) => {
      const row = byTask.get(task)
      return { task, calls: row?.calls ?? 0, input: row?.input ?? 0, output: row?.output ?? 0 }
    }),
    schools: schoolRows,
    dayRows: periodDays.map((date) => {
      const row = byDay.get(date)
      if (!row) return { day: date, ok: 0, limit: 0, others: 0 }
      return { day: date, ok: row.ok, limit: row.limit, others: row.calls - row.ok - row.limit }
    }),
  }
}
