import 'server-only'
import { and, eq, gte } from 'drizzle-orm'
import { t } from '@testmaker/core/i18n'
import type { RegenerateReason } from '@testmaker/core/schema'
import { db, grades, questionFeedback, questions, subjects, topics } from '@/db'
import { inSchool, type Scope } from './user'

/** Default overview window: what happened lately, not the school's whole history. */
const WINDOW_DAYS = 90

export interface ModelRow {
  model: string
  generated: number
  regenerated: number
}

export interface ReasonRow {
  reason: RegenerateReason | null
  count: number
}

export interface SubjectRow {
  subject: string
  regenerated: number
  topReason: RegenerateReason | null
}

export interface AiQuality {
  models: ModelRow[]
  reasons: ReasonRow[]
  bySubject: SubjectRow[]
}

function defaultFrom(): string {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Generation quality overview for Management: how many questions each model
 * generated and how many of them teachers eventually regenerated (with the
 * share, also without a reason), the most common regeneration reasons and the
 * subjects with the most regeneration. The default period is the last three
 * months — older regenerations interest nobody, the model may have changed.
 *
 * Accepted simplification: `generated` and `regenerated` each have their own
 * ninety-day window — the first by `questions.created_at` (when the question
 * was created), the second by `question_feedback.created_at` (when the teacher
 * rejected it). A question generated 89 days ago and regenerated today counts
 * in both windows, but one generated a year ago and regenerated today no
 * longer falls into "generated" — so the share for such a model can exceed
 * 100 % (more regenerations than generations visible in the window). The UI
 * handles that by capping the percentage and showing "—" for division by
 * zero; exact linking would require fetching `questions.created_at` for
 * regenerated questions too, which is not worth the extra complexity for an
 * indicative overview.
 */
export async function loadAiQuality(scope: Scope, options: { since?: string } = {}): Promise<AiQuality> {
  const since = options.since ?? defaultFrom()
  // Questions without a stored model — older ones, from before the model was tracked.
  const unknownModel = t('admin:aiQuality.unknownModel')

  const generatedRows = await db
    .select({ model: questions.model })
    .from(questions)
    .where(and(inSchool(scope, questions), eq(questions.source, 'ai'), gte(questions.createdAt, since)))

  // Restoring a regenerated (rejected) question back to approved does not
  // delete its row here — the regeneration happened and the teacher merely
  // changed her mind; the number in the overview therefore stays, as if it
  // were an accepted decision.
  const feedbackRows = await db
    .select({ model: questionFeedback.model, reason: questionFeedback.reason })
    .from(questionFeedback)
    .where(and(inSchool(scope, questionFeedback), gte(questionFeedback.createdAt, since)))

  // The subject is known only where the feedback still points to an existing
  // question with a topic — otherwise there is nobody to attribute it to.
  const subjectRows = await db
    .select({ subject: subjects.name, reason: questionFeedback.reason })
    .from(questionFeedback)
    .innerJoin(questions, eq(questions.id, questionFeedback.questionId))
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(inSchool(scope, questionFeedback), gte(questionFeedback.createdAt, since)))

  const models = new Map<string, ModelRow>()
  const modelRow = (model: string): ModelRow => {
    const existing = models.get(model)
    if (existing) return existing
    const newItem: ModelRow = { model, generated: 0, regenerated: 0 }
    models.set(model, newItem)
    return newItem
  }
  for (const row of generatedRows) {
    modelRow(row.model ?? unknownModel).generated += 1
  }
  for (const row of feedbackRows) {
    modelRow(row.model ?? unknownModel).regenerated += 1
  }

  const reasons = new Map<RegenerateReason | null, number>()
  for (const row of feedbackRows) {
    const reason = row.reason ?? null
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }

  interface SubjectAggregate {
    regenerated: number
    reasons: Map<RegenerateReason | null, number>
  }
  const subjectMap = new Map<string, SubjectAggregate>()
  for (const row of subjectRows) {
    const aggregate = subjectMap.get(row.subject) ?? { regenerated: 0, reasons: new Map() }
    aggregate.regenerated += 1
    const reason = row.reason ?? null
    aggregate.reasons.set(reason, (aggregate.reasons.get(reason) ?? 0) + 1)
    subjectMap.set(row.subject, aggregate)
  }

  return {
    models: [...models.values()].sort(
      (a, b) => b.generated - a.generated || b.regenerated - a.regenerated,
    ),
    reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    bySubject: [...subjectMap.entries()]
      .map(([subject, aggregate]) => {
        // The most common reason in the subject — on a tie the one seen first wins.
        let topReason: RegenerateReason | null = null
        let max = -1
        for (const [reason, count] of aggregate.reasons) {
          if (count > max) {
            max = count
            topReason = reason
          }
        }
        return { subject, regenerated: aggregate.regenerated, topReason }
      })
      .sort((a, b) => b.regenerated - a.regenerated),
  }
}
