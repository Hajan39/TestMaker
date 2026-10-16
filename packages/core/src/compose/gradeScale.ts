/**
 * Grade boundaries (1 = best … 5 = worst) for a test's total points, as the
 * teacher prints them on her key.
 *
 * For totals 8–45 the school's own printed table ("Tabulka bodového hodnocení
 * pro žáky ZŠ") is used verbatim — it was made by hand and does not follow
 * the percentages exactly, and in two rows the ranges deliberately overlap
 * (36 points: grade 3 is 26–16, grade 4 is 16–9; 16 points: grade 4 is 6–3,
 * grade 5 is 3–0). Other totals (under 8, over 45, half points) fall back to
 * the percentages printed at the top of that table.
 */

export interface GradeRange {
  grade: 1 | 2 | 3 | 4 | 5
  /** Highest points of the range. */
  from: number
  /** Lowest points of the range. */
  to: number
}

/** [from, to] for grades 1–5, keyed by total points — transcribed from the school table. */
const SCHOOL_TABLE: Record<number, [number, number][]> = {
  45: [[45, 41], [40, 34], [33, 20], [19, 11], [10, 0]],
  44: [[44, 40], [39, 33], [32, 20], [19, 11], [10, 0]],
  43: [[43, 39], [38, 32], [31, 19], [18, 11], [10, 0]],
  42: [[42, 38], [37, 32], [31, 19], [18, 11], [10, 0]],
  41: [[41, 37], [36, 31], [30, 18], [17, 10], [9, 0]],
  40: [[40, 36], [35, 30], [29, 18], [17, 10], [9, 0]],
  39: [[39, 35], [34, 29], [28, 18], [17, 10], [9, 0]],
  38: [[38, 34], [33, 29], [28, 17], [16, 10], [9, 0]],
  37: [[37, 33], [32, 28], [27, 17], [16, 9], [8, 0]],
  36: [[36, 32], [31, 27], [26, 16], [16, 9], [8, 0]],
  35: [[35, 32], [31, 26], [25, 16], [15, 9], [8, 0]],
  34: [[34, 31], [30, 26], [25, 15], [14, 9], [8, 0]],
  33: [[33, 30], [29, 25], [24, 15], [14, 8], [7, 0]],
  32: [[32, 29], [28, 24], [23, 14], [13, 8], [7, 0]],
  31: [[31, 28], [27, 23], [22, 14], [13, 8], [7, 0]],
  30: [[30, 27], [26, 23], [22, 14], [13, 8], [7, 0]],
  29: [[29, 26], [25, 22], [21, 13], [12, 7], [6, 0]],
  28: [[28, 25], [24, 21], [20, 13], [12, 7], [6, 0]],
  27: [[27, 24], [23, 20], [19, 12], [11, 6], [5, 0]],
  26: [[26, 23], [22, 19], [18, 12], [11, 6], [5, 0]],
  25: [[25, 23], [22, 19], [18, 11], [10, 6], [5, 0]],
  24: [[24, 22], [21, 18], [17, 11], [10, 6], [5, 0]],
  23: [[23, 21], [20, 17], [16, 10], [9, 5], [4, 0]],
  22: [[22, 20], [19, 16], [15, 10], [9, 5], [4, 0]],
  21: [[21, 19], [18, 15], [14, 9], [8, 4], [3, 0]],
  20: [[20, 18], [17, 14], [13, 8], [7, 4], [3, 0]],
  19: [[19, 17], [16, 14], [13, 8], [7, 4], [3, 0]],
  18: [[18, 17], [16, 13], [12, 8], [7, 4], [3, 0]],
  17: [[17, 16], [15, 13], [12, 8], [7, 4], [3, 0]],
  16: [[16, 15], [14, 12], [11, 7], [6, 3], [3, 0]],
  15: [[15, 14], [13, 11], [10, 7], [6, 3], [2, 0]],
  14: [[14, 13], [12, 10], [9, 6], [5, 3], [2, 0]],
  13: [[13, 12], [11, 9], [8, 5], [4, 3], [2, 0]],
  12: [[12, 11], [10, 8], [7, 5], [4, 3], [2, 0]],
  11: [[11, 10], [9, 8], [7, 5], [4, 3], [2, 0]],
  10: [[10, 9], [8, 7], [6, 4], [3, 2], [1, 0]],
  9: [[9, 8], [7, 6], [5, 4], [3, 2], [1, 0]],
  8: [[8, 8], [7, 6], [5, 4], [3, 2], [1, 0]],
}

/** Lowest share of points for grades 1–4 (the table's header: 90 / 75 / 45 / 25 %). */
const GRADE_SHARES = [0.9, 0.75, 0.45, 0.25] as const

const GRADES = [1, 2, 3, 4, 5] as const

/**
 * Grade ranges for the given total, or null when there is nothing to grade.
 * Outside the table each grade starts at its share of the total rounded to the
 * scoring step (whole points, half points when the total has a half), and
 * ends one step below the better grade's start.
 */
export function gradeBoundaries(total: number): GradeRange[] | null {
  if (!(total > 0)) return null
  const table = SCHOOL_TABLE[total]
  if (table) return table.map(([from, to], i) => ({ grade: GRADES[i]!, from, to }))

  const step = Number.isInteger(total) ? 1 : 0.5
  const snap = (value: number) => Math.round(value / step) * step
  const starts = GRADE_SHARES.map((share) => snap(total * share))
  return GRADES.map((grade, i) => {
    const from = i === 0 ? total : starts[i - 1]! - step
    const to = i < starts.length ? starts[i]! : 0
    return { grade, from: Math.max(from, to), to }
  })
}
