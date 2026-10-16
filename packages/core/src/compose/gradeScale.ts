import { DEFAULT_GRADE_SCALE, type GradeScale } from '../schema/gradeScale'

/**
 * Grade boundaries (1 = best … 5 = worst) for a test's total points, as the
 * teacher prints them on her key.
 *
 * A total that has a row in the school's table (`GradeScale.rows`) is used
 * verbatim — the built-in table was made by hand and does not follow the
 * percentages exactly. Other totals (outside the table, half points) fall back
 * to the scale's percentages.
 */

export interface GradeRange {
  grade: 1 | 2 | 3 | 4 | 5
  /** Highest points of the range. */
  from: number
  /** Lowest points of the range. */
  to: number
}

const GRADES = [1, 2, 3, 4, 5] as const

/**
 * Grade ranges for the given total, or null when there is nothing to grade.
 * Outside the table each grade starts at its share of the total rounded to the
 * scoring step (whole points, half points when the total has a half), and
 * ends one step below the better grade's start.
 */
export function gradeBoundaries(total: number, scale: GradeScale = DEFAULT_GRADE_SCALE): GradeRange[] | null {
  if (!(total > 0)) return null
  const row = scale.rows.find((candidate) => candidate.total === total)
  if (row) return row.ranges.map(([from, to], i) => ({ grade: GRADES[i]!, from, to }))

  const step = Number.isInteger(total) ? 1 : 0.5
  const snap = (value: number) => Math.round(value / step) * step
  const starts = scale.percents.map((percent) => snap((total * percent) / 100))
  return GRADES.map((grade, i) => {
    const from = i === 0 ? total : starts[i - 1]! - step
    const to = i < starts.length ? starts[i]! : 0
    return { grade, from: Math.max(from, to), to }
  })
}
