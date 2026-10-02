/**
 * How the models stand with their daily limits. Gemini does not report what
 * is left — it only answers 429 once the limit is used up — so the estimate is
 * learned from experience: a day on which a model hit the limit and never
 * answered again tells how many calls the limit allowed. Pure functions over
 * call records, so they can be tested without a database.
 */

import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

/** Google resets daily limits at midnight Pacific time. */
const QUOTA_TIME_ZONE = 'America/Los_Angeles'
/** How many past quota days the estimate learns from. */
export const QUOTA_HISTORY_DAYS = 30
const HOUR_MS = 60 * 60 * 1000

export interface QuotaCall {
  model: string
  outcome: 'ok' | 'limit' | 'bad_shape' | 'error'
  /** ISO time of the call. */
  createdAt: string
}

export interface ModelQuota {
  model: string
  /** Calls since today's reset that count against the limit (everything but a refused 429). */
  today: number
  /** When the model hit the limit today for good (no answer after it); `null` if it has not. */
  exhaustedAt: string | null
  /** Learned daily limit: the median of days that ended on the limit; `null` without such a day. */
  estimate: number | null
  /** How many days the estimate is based on. */
  basedOnDays: number
  /** `estimate - today`, never below zero; `null` without an estimate. */
  remaining: number | null
  /** At today's pace the limit runs out around this time (before the next reset); otherwise `null`. */
  runsOutAt: string | null
}

export interface QuotaOutlook {
  /** Start of the current quota day (ISO). */
  resetAt: string
  /** Next reset (ISO). */
  nextResetAt: string
  models: ModelQuota[]
}

/** The quota day of a moment as `YYYY-MM-DD` in Pacific time. */
export function quotaDay(instant: number): string {
  return dayjs(instant).tz(QUOTA_TIME_ZONE).format('YYYY-MM-DD')
}

/** Start of the quota day containing `instant` — midnight Pacific time, as a UTC timestamp. */
export function quotaDayStart(instant: number): number {
  return dayjs(instant).tz(QUOTA_TIME_ZONE).startOf('day').valueOf()
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

interface DayStats {
  counted: number
  /** Time of the last refused call, and whether any call was answered after it. */
  lastLimitAt: number | null
  answeredAfterLimit: boolean
}

function dayStats(calls: QuotaCall[]): DayStats {
  const sorted = [...calls].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const stats: DayStats = { counted: 0, lastLimitAt: null, answeredAfterLimit: false }
  for (const call of sorted) {
    if (call.outcome === 'limit') {
      stats.lastLimitAt = Date.parse(call.createdAt)
      stats.answeredAfterLimit = false
    } else {
      stats.counted += 1
      if (stats.lastLimitAt !== null) stats.answeredAfterLimit = true
    }
  }
  return stats
}

/**
 * Daily limit outlook per model. A day "ended on the limit" when the model
 * refused a call and never answered again that day — a per-minute limit is
 * over within a minute and answers come back, so it does not skew the estimate.
 */
export function quotaOutlook(calls: QuotaCall[], models: string[], now: number = Date.now()): QuotaOutlook {
  const resetAt = quotaDayStart(now)
  const nextResetAt = dayjs(resetAt).tz(QUOTA_TIME_ZONE).add(1, 'day').startOf('day').valueOf()
  const today = quotaDay(now)

  const byModelDay = new Map<string, Map<string, QuotaCall[]>>()
  for (const call of calls) {
    const days = byModelDay.get(call.model) ?? new Map<string, QuotaCall[]>()
    const day = quotaDay(Date.parse(call.createdAt))
    days.set(day, [...(days.get(day) ?? []), call])
    byModelDay.set(call.model, days)
  }

  const names = [...new Set([...models, ...byModelDay.keys()])]
  return {
    resetAt: new Date(resetAt).toISOString(),
    nextResetAt: new Date(nextResetAt).toISOString(),
    models: names.map((model) => {
      const days = byModelDay.get(model) ?? new Map<string, QuotaCall[]>()
      const capped = [...days.entries()]
        .filter(([day]) => day !== today)
        .map(([, dayCalls]) => dayStats(dayCalls))
        .filter((stats) => stats.lastLimitAt !== null && !stats.answeredAfterLimit && stats.counted > 0)
        .map((stats) => stats.counted)
      const estimate = capped.length > 0 ? median(capped) : null

      const todayStats = dayStats(days.get(today) ?? [])
      const exhausted = todayStats.lastLimitAt !== null && !todayStats.answeredAfterLimit
      const remaining = estimate === null ? null : Math.max(0, estimate - todayStats.counted)

      // Pace since the reset, at least over one hour — a few calls just after
      // midnight would otherwise predict the limit running out in minutes.
      let runsOutAt: string | null = null
      if (!exhausted && remaining !== null && todayStats.counted > 0) {
        const perMs = todayStats.counted / Math.max(HOUR_MS, now - resetAt)
        const at = now + remaining / perMs
        if (at < nextResetAt) runsOutAt = new Date(at).toISOString()
      }

      return {
        model,
        today: todayStats.counted,
        exhaustedAt: exhausted ? new Date(todayStats.lastLimitAt!).toISOString() : null,
        estimate,
        basedOnDays: capped.length,
        remaining,
        runsOutAt,
      }
    }),
  }
}
