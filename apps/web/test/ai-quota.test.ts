import { describe, expect, it } from 'vitest'
import { quotaDay, quotaDayStart, quotaOutlook, type QuotaCall } from '@/lib/aiQuota'

const MODEL = 'google:gemini-flash-latest'

/** `count` answered calls a minute apart from `start`, optionally followed by refused ones. */
function day(start: string, count: number, refusedAfter = 0): QuotaCall[] {
  const base = Date.parse(start)
  const calls: QuotaCall[] = Array.from({ length: count }, (_, i) => ({
    model: MODEL,
    outcome: 'ok',
    createdAt: new Date(base + i * 60_000).toISOString(),
  }))
  for (let i = 0; i < refusedAfter; i += 1) {
    calls.push({ model: MODEL, outcome: 'limit', createdAt: new Date(base + (count + i) * 60_000).toISOString() })
  }
  return calls
}

describe('quota day', () => {
  it('starts at midnight Pacific time — 9:00 in Prague in summer', () => {
    // 2 Oct 2026, 12:00 UTC is 5:00 in Los Angeles (PDT, UTC−7).
    const noon = Date.parse('2026-10-02T12:00:00Z')
    expect(quotaDay(noon)).toBe('2026-10-02')
    expect(new Date(quotaDayStart(noon)).toISOString()).toBe('2026-10-02T07:00:00.000Z')
    // 3:00 UTC is still the previous evening in Los Angeles.
    expect(quotaDay(Date.parse('2026-10-02T03:00:00Z'))).toBe('2026-10-01')
  })

  it('follows winter time too', () => {
    expect(new Date(quotaDayStart(Date.parse('2026-12-10T12:00:00Z'))).toISOString()).toBe('2026-12-10T08:00:00.000Z')
  })
})

describe('daily limit outlook', () => {
  const now = Date.parse('2026-10-02T13:00:00Z') // 6 hours after today's reset

  it('learns the limit from days that ended on it and predicts what is left', () => {
    const calls = [
      ...day('2026-09-29T10:00:00Z', 20, 2),
      ...day('2026-09-30T10:00:00Z', 22, 1),
      ...day('2026-10-01T10:00:00Z', 18, 3),
      ...day('2026-10-02T08:00:00Z', 6),
    ]
    const [quota] = quotaOutlook(calls, [MODEL], now).models
    expect(quota).toMatchObject({ today: 6, estimate: 20, basedOnDays: 3, remaining: 14, exhaustedAt: null })
    // 6 calls in 6 hours, 14 left → 14 more hours, just before the next reset (7:00 UTC).
    expect(quota!.runsOutAt).toBe('2026-10-03T03:00:00.000Z')
  })

  it('a slow pace that outlasts the day predicts nothing', () => {
    const calls = [...day('2026-10-01T10:00:00Z', 20, 1), ...day('2026-10-02T08:00:00Z', 2)]
    const [quota] = quotaOutlook(calls, [MODEL], now).models
    expect(quota!.runsOutAt).toBeNull()
  })

  it('a per-minute limit with answers after it does not count as the daily limit', () => {
    const calls = [
      ...day('2026-09-30T10:00:00Z', 3, 1),
      ...day('2026-09-30T10:10:00Z', 40),
    ]
    const [quota] = quotaOutlook(calls, [MODEL], now).models
    expect(quota).toMatchObject({ estimate: null, basedOnDays: 0, remaining: null })
  })

  it('reports a limit used up today and when', () => {
    const calls = [...day('2026-10-01T10:00:00Z', 20, 1), ...day('2026-10-02T08:00:00Z', 20, 2)]
    const [quota] = quotaOutlook(calls, [MODEL], now).models
    expect(quota!.exhaustedAt).toBe('2026-10-02T08:21:00.000Z')
    expect(quota!.remaining).toBe(0)
  })

  it('at a fast pace it predicts the time the limit runs out today', () => {
    const calls = [...day('2026-10-01T10:00:00Z', 100, 1), ...day('2026-10-02T12:00:00Z', 50)]
    const [quota] = quotaOutlook(calls, [MODEL], now).models
    expect(quota!.remaining).toBe(50)
    expect(quota!.runsOutAt).not.toBeNull()
    expect(Date.parse(quota!.runsOutAt!)).toBeGreaterThan(now)
  })

  it('lists a ladder model even without any call', () => {
    const outlook = quotaOutlook([], ['google:gemini-flash-lite-latest'], now)
    expect(outlook.models).toEqual([
      expect.objectContaining({ model: 'google:gemini-flash-lite-latest', today: 0, estimate: null }),
    ])
  })
})
