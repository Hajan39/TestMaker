import type { Question } from '../schema/question'

/** One step of partial scoring: this many errors earn this many points. */
export interface ScoringStep {
  errors: number
  points: number
}

/** Number of separately scored parts of a question; 0 for types scored as a whole. */
export function scoredParts(question: Question): number {
  switch (question.type) {
    case 'multi_choice':
      return question.payload.correctIndices.length
    case 'true_false':
      return question.payload.statements.length
    case 'fill_blank':
      return question.payload.blanks.length
    case 'matching':
      return question.payload.pairs.length
    case 'ordering':
      return question.payload.items.length
    case 'table_fill':
      return question.payload.rows.flat().filter((cell) => cell === null).length
    case 'label_image':
      return question.payload.labels.length
    default:
      return 0
  }
}

/**
 * The owner's partial-scoring rule, one for the whole app: every error (a
 * missing correct answer or a wrongly marked/filled part) deducts
 * `points / parts`, the result is rounded down to a half point, minimum 0.
 * The steps end with the first 0 — it stands for "that many errors or more".
 * Returns null for questions scored as a whole (fewer than 2 parts or 0 points).
 */
export function partialScoring(question: Question, points: number): ScoringStep[] | null {
  const parts = scoredParts(question)
  if (parts < 2 || points <= 0) return null
  const steps: ScoringStep[] = [{ errors: 0, points }]
  for (let errors = 1; errors <= parts; errors++) {
    // The epsilon absorbs float error (2.9999… must floor to 3, not 2.5).
    const value = Math.max(0, Math.floor(((points * (parts - errors)) / parts) * 2 + 1e-9) / 2)
    steps.push({ errors, points: value })
    if (value === 0) break
  }
  return steps
}
