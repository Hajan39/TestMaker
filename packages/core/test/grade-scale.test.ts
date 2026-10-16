import { describe, expect, it } from 'vitest'
import { gradeBoundaries } from '../src/compose/gradeScale'
import { formatGradeBoundaries } from '../src/pdf/answerKey'
import { DEFAULT_GRADE_SCALE, gradeScaleSchema, type GradeScale } from '../src/schema/gradeScale'

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

describe('gradeScaleSchema', () => {
  /** The default scale with one row replaced. */
  const withRow = (total: number, ranges: number[][]) => ({
    ...DEFAULT_GRADE_SCALE,
    rows: [{ total, ranges }, ...DEFAULT_GRADE_SCALE.rows.filter((row) => row.total !== total)],
  })
  const messages = (input: unknown) => {
    const result = gradeScaleSchema.safeParse(input)
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  }

  it('accepts the built-in table including its two shared points', () => {
    expect(gradeScaleSchema.safeParse(DEFAULT_GRADE_SCALE).success).toBe(true)
    expect(DEFAULT_GRADE_SCALE.rows.map((row) => row.total)).toEqual(
      Array.from({ length: 38 }, (_, i) => 45 - i),
    )
  })

  it('rejects a gap between two grades', () => {
    expect(messages(withRow(20, [[20, 18], [16, 14], [13, 8], [7, 4], [3, 0]]))).toEqual([
      'rows.0.ranges.1.0: Mezi známkou 1 a 2 chybí body – známka 2 má začínat na 17.',
    ])
  })

  it('rejects an overlap of more than one point and a range running upwards', () => {
    expect(messages(withRow(20, [[20, 18], [19, 14], [13, 8], [7, 4], [3, 0]]))).toEqual([
      'rows.0.ranges.1.0: Známka 2 smí začínat nejvýš tam, kde končí známka 1 (18).',
    ])
    expect(messages(withRow(20, [[20, 18], [17, 14], [13, 8], [4, 7], [3, 0]]))).toContain(
      'rows.0.ranges.3.1: U známky 4 musí být „od“ aspoň tolik jako „do“.',
    )
  })

  it('requires grade 1 from the total, grade 5 down to zero and unique totals', () => {
    expect(messages(withRow(20, [[19, 18], [17, 14], [13, 8], [7, 4], [3, 1]]))).toEqual([
      'rows.0.ranges.0.0: Známka 1 musí začínat na plném počtu bodů (20).',
      'rows.0.ranges.4.1: Známka 5 musí končit na 0 bodech.',
    ])
    const doubled = { ...DEFAULT_GRADE_SCALE, rows: [...DEFAULT_GRADE_SCALE.rows, DEFAULT_GRADE_SCALE.rows[0]!] }
    expect(messages(doubled)).toEqual(['rows.38.total: Řádek pro 45 bodů je v tabulce dvakrát.'])
  })

  it('requires whole points and strictly descending percentages', () => {
    expect(messages(withRow(20, [[20, 18.5], [17, 14], [13, 8], [7, 4], [3, 0]]))).toEqual([
      'rows.0.ranges.0.1: Zadej celé číslo bodů od 0 do 200.',
    ])
    expect(messages({ ...DEFAULT_GRADE_SCALE, percents: [90, 90, 45, 25] })).toEqual([
      'percents.1: Procento pro známku 2 musí být nižší než pro známku 1.',
    ])
  })
})

describe('gradeBoundaries with a school scale', () => {
  const scale: GradeScale = {
    percents: [80, 60, 40, 20],
    rows: [{ total: 10, ranges: [[10, 10], [9, 7], [6, 4], [3, 2], [1, 0]] }],
  }

  it('uses the school’s own row and its percentages elsewhere', () => {
    expect(gradeBoundaries(10, scale)?.map(({ from, to }) => [from, to])).toEqual([[10, 10], [9, 7], [6, 4], [3, 2], [1, 0]])
    // 50 points: 40, 30, 20, 10.
    expect(gradeBoundaries(50, scale)?.map(({ from, to }) => [from, to])).toEqual([[50, 40], [39, 30], [29, 20], [19, 10], [9, 0]])
    // A total the school dropped from its table falls back to its percentages too.
    expect(formatGradeBoundaries(45, scale)).toBe('Známky: 1: 45–36 · 2: 35–27 · 3: 26–18 · 4: 17–9 · 5: 8–0')
  })
})
