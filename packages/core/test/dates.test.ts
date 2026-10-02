import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatShortDateTime, formatTime, fromNow, isoAgo, minutesSince } from '../src/dates'

describe('dates', () => {
  it('shows times in Prague whatever the machine zone is', () => {
    // 19:30 UTC is 21:30 in Prague in summer.
    expect(formatDateTime('2026-10-02T19:30:00Z')).toBe('2. 10. 2026 21:30')
    expect(formatShortDateTime('2026-10-02T19:30:00Z')).toBe('2. 10. 21:30')
    expect(formatTime('2026-12-02T19:30:00Z')).toBe('20:30')
    // Late evening UTC is already the next day in Prague.
    expect(formatDate('2026-10-02T23:30:00Z')).toBe('3. 10. 2026')
  })

  it('relative time is in Czech', () => {
    const now = Date.parse('2026-10-02T12:00:00Z')
    expect(fromNow('2026-10-02T11:55:00Z', now)).toBe('před 5 minutami')
    expect(minutesSince('2026-10-02T11:55:00Z', now)).toBe(5)
    expect(isoAgo(2, 'day', now)).toBe('2026-09-30T12:00:00.000Z')
  })
})
