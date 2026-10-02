import 'server-only'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { generateQuestions, type AiCallListener } from '@testmaker/core/ai'
import {
  AI_QUESTION_TYPES,
  REGENERATE_REASONS,
  type Question,
  type QuestionType,
  type RegenerateReason,
} from '@testmaker/core/schema'
import {
  db,
  generationJobs,
  grades,
  materials,
  questionFeedback,
  questions,
  subjects,
  topics,
  users,
  type QuestionRow,
} from '@/db'
import { callRecorder } from '@/lib/aiUsage'
import { inSchool, type Scope } from '@/lib/user'
import { newId } from '@/lib/ids'
import { MIN_GENERATE_CHARS } from '@/lib/materials'
import { loadActivePromptRules } from '@/lib/promptRules'
import { insertQuestions, loadAvoidPrompts, questionPrompt, toQuestion } from './questions'
import { expireStaleJobs } from './jobs'
import { t } from '@testmaker/core/i18n'

export interface GenerateParams {
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
  /**
   * `add` = create `count` new questions.
   * `target` = top the topic up so it holds `count` questions in total.
   * Topping up is what the teacher wants for a topic that already has some:
   * she rejects part of the questions and needs to restore the count, not start over.
   */
  mode?: 'add' | 'target'
}

export const DEFAULT_GENERATE_PARAMS: GenerateParams = {
  count: 10,
  types: [...AI_QUESTION_TYPES],
  difficulty: 'mix',
  mode: 'add',
}

/**
 * How many questions this run should actually create. When topping up, only
 * questions still usable in the topic count — rejected ones don't, otherwise
 * a top-up would never create anything.
 */
export async function resolveCount(
  scope: Scope,
  topicId: string,
  params: GenerateParams,
): Promise<number> {
  if (params.mode !== 'target') return params.count
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(questions)
    .where(
      and(inSchool(scope, questions), eq(questions.topicId, topicId), ne(questions.status, 'rejected')),
    )
  return Math.max(0, params.count - Number(row?.value ?? 0))
}

export interface GenerateOutcome {
  created: number
  rejected: number
  /** Calls that yielded nothing usable. */
  failedCalls: number
  topicId: string
  /** How many materials the generation used. */
  sources: number
  /**
   * Models that produced the questions (`provider:model`). More than one
   * means the ladder moved on after a quota ran out — quality differs between
   * models, so the message must make that visible.
   */
  models: string[]
}

/**
 * Claims a topic for generation. Two simultaneous generations over the same
 * topic don't know about each other — each loads the "avoid these questions"
 * list at the start, so they would reliably produce duplicates. The claim lives
 * in the same table as the queue so bulk and manual runs see each other.
 *
 * The lock is per topic, not per teacher: the library is shared and two runs
 * over one topic would pour the same questions into it.
 *
 * Returns the claim id, or `null` when someone is already processing the topic.
 */
export async function claimTopic(scope: Scope, topicId: string): Promise<string | null> {
  // A claim left behind by a request the server cut off must not lock the topic forever.
  await expireStaleJobs(scope)
  const id = newId()
  const startedAt = new Date().toISOString()

  // The whole claim is one statement: `insert … select … where not exists`.
  // A read and a write in two steps aren't atomic on Turso — a second run fits
  // in between and both claim the topic. A single statement writes under the
  // database lock, so exactly one of them satisfies the condition.
  const claimed = await db.all<{ id: string }>(sql`
    insert into ${generationJobs} (id, school_id, requested_by, topic_id, params, status, started_at)
    select ${id}, ${scope.schoolId}, ${scope.userId}, ${topicId},
           ${JSON.stringify({ ...DEFAULT_GENERATE_PARAMS, direct: true })}, 'running', ${startedAt}
    where not exists (
      select 1 from ${generationJobs}
      where topic_id = ${topicId} and status in ('queued', 'running')
    )
    returning id
  `)

  return claimed.length > 0 ? id : null
}

/** Releases the topic claim and records how the generation ended. */
export async function releaseTopic(
  jobId: string,
  outcome: { created?: number; error?: string } = {},
): Promise<void> {
  await db
    .update(generationJobs)
    .set({
      status: outcome.error ? 'error' : 'done',
      error: outcome.error ?? null,
      producedCount: outcome.created ?? 0,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(generationJobs.id, jobId))
}

/** Text of a topic's whole material group, with a header per file. */
export async function loadTopicSource(
  scope: Scope,
  topicId: string,
): Promise<{
  text: string
  topicName: string
  gradeName: string
  subjectName: string
  sources: number
} | null> {
  const [meta] = await db
    .select({ topicName: topics.name, gradeName: grades.name, subjectName: subjects.name })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(inSchool(scope, topics), eq(topics.id, topicId)))
    .limit(1)
  if (!meta) return null

  // Duplicate exports of the same content and manually excluded materials don't
  // belong in the source — a duplicate would double the questions, and an
  // excluded material is one the teacher deliberately keeps out.
  const rows = await db
    .select({ fileName: materials.fileName, text: materials.text })
    .from(materials)
    .where(
      and(
        inSchool(scope, materials),
        eq(materials.topicId, topicId),
        isNull(materials.duplicateOfId),
        eq(materials.excluded, false),
      ),
    )
    .orderBy(asc(materials.fileName))

  const text = rows
    .map((row) => `=== ${row.fileName} ===\n${row.text}`)
    .join('\n\n')
    .trim()

  return { ...meta, text, sources: rows.length }
}

/**
 * Generates questions from a topic's whole material group.
 * One file is often not enough for a test and generating per file leads to
 * repeated questions, so the input is always the whole topic.
 */
export async function generateForTopic(
  scope: Scope,
  topicId: string,
  params: GenerateParams,
  options: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
    /**
     * Called after each saved batch of questions. Generation can take ten
     * minutes and the only sign for the teacher that something is happening
     * is the questions that have appeared — so they go out right away, not at the end.
     */
    onSaved?: (info: { created: number; questions: Question[] }) => void | Promise<void>
    /** Fake generation for tests; the app never passes it. */
    generate?: typeof generateQuestions
    /**
     * Where to record model calls for the AI usage overview. Defaults to the
     * signed-in person from `scope`; the queue passes a recorder without a user.
     */
    onCall?: AiCallListener
  } = {},
): Promise<GenerateOutcome> {
  const wanted = await resolveCount(scope, topicId, params)
  if (wanted <= 0) {
    return { created: 0, rejected: 0, failedCalls: 0, topicId, sources: 0, models: [] }
  }

  const source = await loadTopicSource(scope, topicId)
  if (!source) throw new Error(t('generation:generation.topicNotFound'))
  if (source.text.trim().length < MIN_GENERATE_CHARS) {
    throw new Error(t('generation:generation.tooLittleText'))
  }

  const avoid = await loadAvoidPrompts(scope, topicId)
  const schoolRules = await loadActivePromptRules(scope)

  // Save batch by batch. If a model call fails midway, finished work stays.
  let created = 0
  const generate = options.generate ?? generateQuestions
  const result = await generate(
    {
      text: source.text,
      topicName: source.topicName,
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      count: wanted,
      types: params.types,
      difficulty: params.difficulty,
      avoid,
      schoolRules,
    },
    {
      signal: options.signal,
      onCall: options.onCall ?? callRecorder(scope, 'otazky'),
      onChunk: options.onProgress,
      onBatch: async (batch, info) => {
        const ids = await insertQuestions(scope, batch, { topicId, source: 'ai' })
        // The producing model is stored only in the database for later quality
        // comparison — the UI never shows it. Written separately so
        // `insertQuestions` stays about question content, not its origin.
        if (ids.length > 0) await db.update(questions).set({ model: info.model }).where(inArray(questions.id, ids))
        created += batch.length

        // Send finished questions out while running — but only when someone
        // wants them, so the queue (where nobody reads them) skips the extra query.
        if (options.onSaved && ids.length > 0) {
          const rows = await db
            .select()
            .from(questions)
            .where(and(inSchool(scope, questions), inArray(questions.id, ids)))
          // Database order isn't guaranteed; return the batch in creation order.
          const byId = new Map(rows.map((row) => [row.id, toQuestion(row)]))
          await options.onSaved({
            created,
            questions: ids.flatMap((id) => {
              const question = byId.get(id)
              return question ? [question] : []
            }),
          })
        }
      },
    },
  )

  return {
    created,
    rejected: result.rejected.length,
    failedCalls: result.failedCalls.length,
    topicId,
    sources: source.sources,
    models: result.models,
  }
}

/**
 * Is a batch generation running over the topic right now? Replacing a single
 * question doesn't claim the topic (`claimTopic`) — it would block the whole
 * topic for minutes over one question. It does read other claims: a replacement
 * landing mid-batch would work from the same "avoid these" list.
 */
export async function isTopicBusy(scope: Scope, topicId: string): Promise<{ who: string } | null> {
  await expireStaleJobs(scope)
  const [running] = await db
    .select({ id: generationJobs.id, who: users.name })
    .from(generationJobs)
    .innerJoin(users, eq(users.id, generationJobs.requestedBy))
    .where(
      and(
        inSchool(scope, generationJobs),
        eq(generationJobs.topicId, topicId),
        inArray(generationJobs.status, ['queued', 'running']),
      ),
    )
    .limit(1)
  return running ? { who: running.who } : null
}

/** Message including the name — without it a blocked topic looks like a fault. */
export function topicBusyMessage(who: string): string {
  return t('generation:generation.topicBusy', { who })
}

/** Difficulty clamped to 1–3 — the shift from a reason must not push it off the scale. */
function clampDifficulty(value: number): 1 | 2 | 3 {
  return Math.min(3, Math.max(1, value)) as 1 | 2 | 3
}

/** Shared groundwork for regenerating a question and for a variant. */
interface RegenerationContext {
  original: QuestionRow
  topicId: string
  source: NonNullable<Awaited<ReturnType<typeof loadTopicSource>>>
  avoid: string[]
  schoolRules: string[]
}

/**
 * Loads the question and everything a replacement or variant needs: checks that
 * the question belongs to a topic not being batch-generated, that the model can
 * produce its type, and the prompt inputs (source text, "avoid" list, school
 * rules). Shared by `regenerateQuestion` and `createVariant` so the checks
 * aren't repeated in two places.
 */
async function loadRegenerationContext(scope: Scope, questionId: string): Promise<RegenerationContext> {
  const [original] = await db
    .select()
    .from(questions)
    .where(and(inSchool(scope, questions), eq(questions.id, questionId)))
    .limit(1)
  if (!original) throw new Error(t('generation:generation.questionNotFound'))
  if (!original.topicId) throw new Error(t('generation:generation.questionWithoutTopic'))

  const topicId = original.topicId
  const busy = await isTopicBusy(scope, topicId)
  if (busy) throw new Error(topicBusyMessage(busy.who))

  if (!AI_QUESTION_TYPES.includes(original.type as (typeof AI_QUESTION_TYPES)[number])) {
    throw new Error(t('generation:generation.typeNotGeneratable'))
  }

  const source = await loadTopicSource(scope, topicId)
  if (!source) throw new Error(t('generation:generation.topicNotFound'))
  if (source.text.trim().length < MIN_GENERATE_CHARS) {
    throw new Error(t('generation:generation.tooLittleText'))
  }

  const avoid = await loadAvoidPrompts(scope, topicId)
  const schoolRules = await loadActivePromptRules(scope)

  return { original, topicId, source, avoid, schoolRules }
}

/**
 * Replaces one question with a new one from the model.
 *
 * Order matters: the replacement must exist first, only then is the original
 * marked rejected. When the model fails or returns something unusable, nothing
 * changes in the database and the caller gets a user-facing message
 * (`describeAiError`) — otherwise a failed attempt would leave the topic one
 * question short and the teacher wouldn't know where it went.
 *
 * `generate` can be injected in tests; the app never passes it.
 *
 * `reason` says why the question is replaced: it carries a prompt hint and, for
 * "too hard"/"too easy", a difficulty shift of the replacement (clamped to 1–3).
 * `note` is the teacher's free-text note on top. Both are optional — one-click
 * regeneration keeps working. A successful replacement always creates a
 * `questionFeedback` row, even without a reason — otherwise we couldn't compute
 * what share of each model's questions teachers end up regenerating.
 */
export async function regenerateQuestion(
  scope: Scope,
  questionId: string,
  options: {
    signal?: AbortSignal
    generate?: typeof generateQuestions
    reason?: RegenerateReason
    note?: string
  } = {},
): Promise<Question> {
  const { original, topicId, source, avoid, schoolRules } = await loadRegenerationContext(scope, questionId)
  const type = original.type

  // The reason gives the model a prompt hint and, for "too hard"/"too easy",
  // shifts the replacement's difficulty — clamped back to 1–3 so it stays on
  // the scale (a too-easy question at difficulty 3 stays at 3, not 4).
  const reasonInfo = options.reason ? REGENERATE_REASONS[options.reason] : undefined
  const originalDifficulty = (original.difficulty as 1 | 2 | 3) ?? 2
  const difficulty = reasonInfo ? clampDifficulty(originalDifficulty + reasonInfo.shift) : originalDifficulty

  const generate = options.generate ?? generateQuestions
  const result = await generate(
    {
      text: source.text,
      topicName: source.topicName,
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      count: 1,
      types: [type as (typeof AI_QUESTION_TYPES)[number]],
      difficulty,
      avoid,
      schoolRules,
      // The replacement comes from the passage the original relied on —
      // otherwise the model would always get the topic's first chunk.
      ...(original.sourceQuote?.trim() ? { focus: original.sourceQuote } : {}),
      ...(reasonInfo ? { replacementReason: { hint: reasonInfo.hint, note: options.note } } : {}),
    },
    { signal: options.signal, onCall: callRecorder(scope, 'otazky') },
  )

  const replacement = result.questions[0]
  if (!replacement) {
    throw new Error(t('generation:generation.noReplacement'))
  }

  // Only now — the replacement exists, the original may go.
  const [replacementId] = await insertQuestions(scope, [replacement], { topicId, source: 'ai' })
  // Model goes to the database only, as with batch generation (never in the UI).
  const usedModel = result.models[0]
  if (replacementId && usedModel) {
    await db.update(questions).set({ model: usedModel }).where(eq(questions.id, replacementId))
  }
  await db
    .update(questions)
    .set({ status: 'rejected', reviewedBy: scope.userId, reviewedAt: new Date().toISOString() })
    .where(and(inSchool(scope, questions), eq(questions.id, questionId)))

  // Feedback is always recorded, even without a reason — otherwise we couldn't
  // compute the share of regenerated questions per producing model. The
  // exception is a hand-written (`manual`) question: no model wrote it, so the
  // row would only add noise to the "AI quality" overview under "unknown model"
  // without saying anything about any model's quality.
  if (original.source === 'ai') {
    await db.insert(questionFeedback).values({
      id: newId(),
      schoolId: scope.schoolId,
      questionId,
      replacementId,
      model: original.model ?? null,
      reason: options.reason ?? null,
      note: options.note?.trim() || null,
      createdBy: scope.userId,
    })
  }

  const [row] = await db
    .select()
    .from(questions)
    .where(and(inSchool(scope, questions), eq(questions.id, replacementId!)))
    .limit(1)
  if (!row) throw new Error(t('generation:generation.replacementSaveFailed'))
  return toQuestion(row)
}

/** Message when the variant's difficulty can't move any further. */
export function variantDifficultyLimitMessage(direction: 'easier' | 'harder'): string {
  return direction === 'easier' ? t('generation:variant.limitEasier') : t('generation:variant.limitHarder')
}

/**
 * Creates an easier or harder version of a question on the same content — not
 * the same thing reworded. Unlike `regenerateQuestion` it doesn't reject the
 * original or record feedback: a variant is an extra question, not a replacement.
 *
 * The variant's root is `original.variantOf ?? original.id` — an easier version
 * of a harder version links to the *original* question, not into a chain, so
 * the question card can offer all the root's versions together (`loadVariantLinks`).
 *
 * `generate` can be injected in tests; the app never passes it.
 */
export async function createVariant(
  scope: Scope,
  questionId: string,
  direction: 'easier' | 'harder',
  options: { signal?: AbortSignal; generate?: typeof generateQuestions } = {},
): Promise<Question> {
  const { original, topicId, source, avoid, schoolRules } = await loadRegenerationContext(scope, questionId)
  const type = original.type

  const originalDifficulty = (original.difficulty as 1 | 2 | 3) ?? 2
  const targetDifficulty = originalDifficulty + (direction === 'easier' ? -1 : 1)
  if (targetDifficulty < 1 || targetDifficulty > 3) {
    throw new Error(variantDifficultyLimitMessage(direction))
  }

  const generate = options.generate ?? generateQuestions
  const result = await generate(
    {
      text: source.text,
      topicName: source.topicName,
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      count: 1,
      types: [type as (typeof AI_QUESTION_TYPES)[number]],
      difficulty: targetDifficulty as 1 | 2 | 3,
      avoid,
      schoolRules,
      // The variant comes from the same passage as the original — same content, different question.
      ...(original.sourceQuote?.trim() ? { focus: original.sourceQuote } : {}),
      variantOf: { direction, originalPrompt: questionPrompt(original) },
    },
    { signal: options.signal, onCall: callRecorder(scope, 'otazky') },
  )

  const generated = result.questions[0]
  if (!generated) {
    throw new Error(t('generation:generation.noVariant'))
  }
  // Store the requested difficulty, not the one the model wrote — the model
  // sometimes returns it unchanged and the "easier version" would then sit at
  // the same level as the original in the bank.
  const variant = { ...generated, difficulty: targetDifficulty as 1 | 2 | 3 }

  // The root is the ancestor, not the question itself — a variant of a variant
  // links to the root, otherwise variants would form a chain.
  const root = original.variantOf ?? original.id
  const [variantId] = await insertQuestions(scope, [variant], { topicId, source: 'ai', variantOf: root })
  const usedModel = result.models[0]
  if (variantId && usedModel) {
    await db.update(questions).set({ model: usedModel }).where(eq(questions.id, variantId))
  }

  const [row] = await db
    .select()
    .from(questions)
    .where(and(inSchool(scope, questions), eq(questions.id, variantId!)))
    .limit(1)
  if (!row) throw new Error(t('generation:generation.variantSaveFailed'))
  return toQuestion(row)
}
