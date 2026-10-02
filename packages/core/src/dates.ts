import dayjs, { type ConfigType, type Dayjs } from 'dayjs'
import 'dayjs/locale/cs'
import relativeTime from 'dayjs/plugin/relativeTime'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(relativeTime)
dayjs.locale('cs')

/**
 * Dates in one place, on dayjs. Times are always shown in the school's time
 * zone, not the machine's: a page is first rendered on the server (UTC on
 * Vercel) and then in the browser — with the machine's zone the two would
 * differ by two hours and React would complain about a mismatch.
 */
export const APP_TIME_ZONE = 'Europe/Prague'

export { dayjs, type Dayjs }

/** A moment in the school's time zone. */
export function local(value: ConfigType): Dayjs {
  return dayjs(value).tz(APP_TIME_ZONE)
}

/** `2. 10. 2026` */
export function formatDate(value: ConfigType): string {
  return local(value).format('D. M. YYYY')
}

/** `2. 10. 2026 21:30` */
export function formatDateTime(value: ConfigType): string {
  return local(value).format('D. M. YYYY H:mm')
}

/** `2. 10. 21:30` — within a period where the year is obvious. */
export function formatShortDateTime(value: ConfigType): string {
  return local(value).format('D. M. H:mm')
}

/** `21:30` */
export function formatTime(value: ConfigType): string {
  return local(value).format('H:mm')
}

/** `před 5 minutami`, `za 2 hodiny` */
export function fromNow(value: ConfigType, now: ConfigType = Date.now()): string {
  return dayjs(value).from(dayjs(now))
}

/** ISO moment `amount` units before `now` — for "last 30 days" style cutoffs. */
export function isoAgo(amount: number, unit: 'minute' | 'hour' | 'day', now: ConfigType = Date.now()): string {
  return dayjs(now).subtract(amount, unit).toISOString()
}

/** Whole minutes from `from` to `now`. */
export function minutesSince(from: ConfigType, now: ConfigType = Date.now()): number {
  return dayjs(now).diff(dayjs(from), 'minute')
}
