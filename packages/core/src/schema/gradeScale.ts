import { z } from 'zod'
import { t } from '../i18n'

/**
 * A school's grade scale (1 = best … 5 = worst): its own table of point ranges
 * for chosen totals, plus the percentages used for every other total. Stored on
 * the school, edited in Správa, printed on the teacher's key.
 */

/** Highest total a row of the table may have — far above any real test. */
export const GRADE_SCALE_MAX_TOTAL = 200

const points = z
  .number({ error: () => t('core:gradeScale.points') })
  .int({ error: () => t('core:gradeScale.points') })
  .min(0, { error: () => t('core:gradeScale.points') })
  .max(GRADE_SCALE_MAX_TOTAL, { error: () => t('core:gradeScale.points') })

/** [from, to] — highest and lowest points of one grade. */
const rangeSchema = z.tuple([points, points])

const percent = z
  .number({ error: () => t('core:gradeScale.percent') })
  .min(0, { error: () => t('core:gradeScale.percent') })
  .max(100, { error: () => t('core:gradeScale.percent') })

/**
 * One row of the table: the ranges of grades 1–5 for one total. Rules:
 * - grade 1 starts at the total, grade 5 ends at 0, each range runs downwards;
 * - the next grade starts one point below where the better one ends — or on
 *   that very point. The shared point is allowed because the school's printed
 *   table has it twice (36 and 16 points); a larger overlap or a gap (points
 *   with no grade) is rejected.
 */
export const gradeScaleRowSchema = z
  .object({
    total: points.min(1, { error: () => t('core:gradeScale.points') }),
    ranges: z.tuple([rangeSchema, rangeSchema, rangeSchema, rangeSchema, rangeSchema]),
  })
  .superRefine(({ total, ranges }, ctx) => {
    // The shape already failed — the field messages say enough.
    if (!Number.isInteger(total) || ranges.flat().some((value) => !Number.isInteger(value))) return
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path: ['ranges', ...path], message })

    if (ranges[0][0] !== total) issue([0, 0], t('core:gradeScale.firstFrom', { total }))
    if (ranges[4][1] !== 0) issue([4, 1], t('core:gradeScale.lastTo'))
    ranges.forEach(([from, to], i) => {
      const grade = i + 1
      if (from < to) issue([i, 1], t('core:gradeScale.reversed', { grade }))
      if (i === 0) return
      const better = ranges[i - 1]![1]
      if (from < better - 1) issue([i, 0], t('core:gradeScale.gap', { grade, better: grade - 1, expected: better - 1 }))
      else if (from > better) issue([i, 0], t('core:gradeScale.overlap', { grade, better: grade - 1, max: better }))
    })
  })

export const gradeScaleSchema = z.object({
  /** Lowest share of points (in %) for grades 1–4 — used for totals outside the table. */
  percents: z.tuple([percent, percent, percent, percent]).superRefine((percents, ctx) => {
    percents.forEach((value, i) => {
      if (i > 0 && !(value < percents[i - 1]!)) {
        ctx.addIssue({ code: 'custom', path: [i], message: t('core:gradeScale.percentsOrder', { grade: i + 1, better: i }) })
      }
    })
  }),
  rows: z
    .array(gradeScaleRowSchema)
    .max(GRADE_SCALE_MAX_TOTAL)
    .superRefine((rows, ctx) => {
      const seen = new Set<number>()
      rows.forEach(({ total }, i) => {
        if (seen.has(total)) {
          ctx.addIssue({ code: 'custom', path: [i, 'total'], message: t('core:gradeScale.duplicateTotal', { total }) })
        }
        seen.add(total)
      })
    }),
})

export type GradeScale = z.infer<typeof gradeScaleSchema>
export type GradeScaleRow = z.infer<typeof gradeScaleRowSchema>

/**
 * [from, to] for grades 1–5, keyed by total points — transcribed verbatim from
 * the school's printed "Tabulka bodového hodnocení pro žáky ZŠ". It was made by
 * hand and does not follow the percentages exactly; in two rows the ranges
 * deliberately share a point (36 points: grade 3 is 26–16, grade 4 is 16–9;
 * 16 points: grade 4 is 6–3, grade 5 is 3–0).
 */
const SCHOOL_TABLE: Record<number, GradeScaleRow['ranges']> = {
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

/** The built-in scale every school starts with: the printed table (45 → 8) and its 90 / 75 / 45 / 25 % header. */
export const DEFAULT_GRADE_SCALE: GradeScale = {
  percents: [90, 75, 45, 25],
  rows: Object.entries(SCHOOL_TABLE)
    .map(([total, ranges]) => ({ total: Number(total), ranges }))
    .sort((a, b) => b.total - a.total),
}
