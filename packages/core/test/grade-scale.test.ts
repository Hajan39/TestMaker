import { describe, expect, it } from 'vitest'
import { gradeBoundaries } from '../src/compose/gradeScale'
import { formatGradeBoundaries } from '../src/pdf/answerKey'

const ranges = (total: number) => gradeBoundaries(total)?.map(({ from, to }) => [from, to])

describe('gradeBoundaries', () => {
  it('takes totals 8–45 verbatim from the school table', () => {
    expect(ranges(45)).toEqual([[45, 41], [40, 34], [33, 20], [19, 11], [10, 0]])
    expect(ranges(20)).toEqual([[20, 18], [17, 14], [13, 8], [7, 4], [3, 0]])
    expect(ranges(8)).toEqual([[8, 8], [7, 6], [5, 4], [3, 2], [1, 0]])
  })

  it('keeps the overlapping rows exactly as the table prints them', () => {
    expect(ranges(36)).toEqual([[36, 32], [31, 27], [26, 16], [16, 9], [8, 0]])
    expect(ranges(16)).toEqual([[16, 15], [14, 12], [11, 7], [6, 3], [3, 0]])
  })

  it('outside the table falls back to 90 / 75 / 45 / 25 % of the total', () => {
    // 50 points: 45, 37.5 → 38, 22.5 → 23, 12.5 → 13.
    expect(ranges(50)).toEqual([[50, 45], [44, 38], [37, 23], [22, 13], [12, 0]])
  })

  it('a total with a half point uses half-point steps', () => {
    // 7.5 points: 6.75 → 7, 5.625 → 5.5, 3.375 → 3.5, 1.875 → 2.
    expect(ranges(7.5)).toEqual([[7.5, 7], [6.5, 5.5], [5, 3.5], [3, 2], [1.5, 0]])
  })

  it('has nothing to grade without points', () => {
    expect(gradeBoundaries(0)).toBeNull()
  })
})

describe('formatGradeBoundaries', () => {
  it('prints the line for the key', () => {
    expect(formatGradeBoundaries(45)).toBe('Známky: 1: 45–41 · 2: 40–34 · 3: 33–20 · 4: 19–11 · 5: 10–0')
    expect(formatGradeBoundaries(8)).toBe('Známky: 1: 8 · 2: 7–6 · 3: 5–4 · 4: 3–2 · 5: 1–0')
  })

  it('writes half points with a decimal comma', () => {
    expect(formatGradeBoundaries(7.5)).toBe('Známky: 1: 7,5–7 · 2: 6,5–5,5 · 3: 5–3,5 · 4: 3–2 · 5: 1,5–0')
  })
})
