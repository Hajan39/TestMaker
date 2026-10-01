import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import type { generateQuestions } from '@testmaker/core/ai'
import { t } from '@testmaker/core/i18n'
import { db, questions, testItems } from '@/db'
import { inSchool, type Scope } from '@/lib/user'
import { createVariant } from '@/lib/generation'
import { loadVariantLinks } from '@/lib/questions'
import { buildQuestionSnapshots, copyTest } from '@/lib/tests'

export type TestVariantDirection = 'easier' | 'harder'

export interface TestVariantOutcome {
  testId: string
  /** How many items got an existing version of the root question. */
  replaced: number
  /** How many items got a freshly generated version. */
  generated: number
  /** How many items kept the original question (difficulty limit, busy topic, model failure). */
  kept: number
}

/** Title of the new test — always from the saved source title, not from unsaved edits. */
export function testVariantTitle(sourceTitle: string, direction: TestVariantDirection): string {
  return direction === 'easier'
    ? t('tests:variant.titleEasier', { title: sourceTitle })
    : t('tests:variant.titleHarder', { title: sourceTitle })
}

/**
 * Creates an easier or harder version of a whole test: a copy of the test in
 * which every question item is replaced by a version of its root question one
 * level easier or harder.
 *
 * The copy is made right at the start (`copyTest`) — once it exists, no error
 * on a single item undoes it; that item just keeps its original question.
 * Only the preliminary check can fail (source test not visible); then nothing
 * is created.
 *
 * For every `question` item with a bank question:
 * 1. Find the root (`variantOf` of the original question, or the question itself).
 * 2. Among the root's versions with difficulty `original ± 1` and a status other
 *    than `rejected`, look for one usable as is (`replaced`) — and not yet in
 *    the copy, so no question appears on the paper twice.
 * 3. If there is none, try `createVariant` (`generated`). If that fails —
 *    difficulty limit, busy topic or the model — the item stays unchanged
 *    (`kept`) and we move on.
 *
 * Items without a bank question (`questionId` null, question hard-deleted) and
 * puzzles stay unchanged and are not counted.
 */
export async function createTestVariant(
  scope: Scope,
  testId: string,
  direction: TestVariantDirection,
  options: {
    /** Called once the copy exists — with its id so the client keeps it if the run fails. */
    onStart?: (total: number, testId: string) => void
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
    /** Stubbed generation for tests; never passed in the app. */
    generate?: typeof generateQuestions
  } = {},
): Promise<TestVariantOutcome> {
  const copy = await copyTest(scope, testId, { title: (title) => testVariantTitle(title, direction) })
  if (!copy) throw new Error(t('tests:api.testNotFoundShort'))

  // Order on paper — `copyTest` does return items in the order it saved them,
  // but without going through `position` the ordering would break if that
  // ever stopped being true.
  const orderedItems = await db
    .select({ id: testItems.id, kind: testItems.kind, questionId: testItems.questionId })
    .from(testItems)
    .where(and(inSchool(scope, testItems), eq(testItems.testId, copy.id)))
    .orderBy(asc(testItems.position))

  const total = orderedItems.length
  options.onStart?.(total, copy.id)

  // Which questions are currently in the copy (with occurrence counts). A
  // replacement is only picked from questions not yet in the copy — otherwise
  // two items, say an original and its easier version, would end up with the
  // same question and it would appear on the paper twice.
  const inCopy = new Map<string, number>()
  const add = (id: string) => inCopy.set(id, (inCopy.get(id) ?? 0) + 1)
  const drop = (id: string) => {
    const count = (inCopy.get(id) ?? 0) - 1
    if (count > 0) inCopy.set(id, count)
    else inCopy.delete(id)
  }
  for (const item of orderedItems) {
    if (item.kind === 'question' && item.questionId) add(item.questionId)
  }

  let replaced = 0
  let generated = 0
  let kept = 0
  let done = 0

  for (const item of orderedItems) {
    if (options.signal?.aborted) break
    if (item.kind !== 'question' || !item.questionId) {
      done += 1
      options.onProgress?.(done, total)
      continue
    }

    const [original] = await db
      .select({ difficulty: questions.difficulty, variantOf: questions.variantOf })
      .from(questions)
      .where(and(inSchool(scope, questions), eq(questions.id, item.questionId)))
      .limit(1)
    if (!original) {
      // The bank question was hard-deleted — there is nothing to take a new version from.
      done += 1
      options.onProgress?.(done, total)
      continue
    }

    const originalDifficulty = (original.difficulty as 1 | 2 | 3) ?? 2
    const targetDifficulty = originalDifficulty + (direction === 'easier' ? -1 : 1)
    const root = original.variantOf ?? item.questionId

    let replacementId: string | null = null
    if (targetDifficulty >= 1 && targetDifficulty <= 3) {
      // Candidates are the root's siblings (`loadVariantLinks`) and the root
      // itself — the question in the test need not be the root of its versions
      // (it may be, say, a harder version we now want easier again), in which
      // case the root itself may be the candidate for the target difficulty.
      const candidates: { id: string; difficulty: number; status: string }[] = []
      if (root !== item.questionId) {
        const [rootRow] = await db
          .select({ id: questions.id, difficulty: questions.difficulty, status: questions.status })
          .from(questions)
          .where(and(inSchool(scope, questions), eq(questions.id, root)))
          .limit(1)
        if (rootRow) candidates.push({ id: rootRow.id, difficulty: rootRow.difficulty ?? 2, status: rootRow.status })
      }
      const links = await loadVariantLinks(scope, [root])
      candidates.push(...(links[root] ?? []))

      const existing = candidates.find(
        (candidate) =>
          candidate.id !== item.questionId &&
          !inCopy.has(candidate.id) &&
          candidate.status !== 'rejected' &&
          candidate.difficulty === targetDifficulty,
      )
      if (existing) {
        replacementId = existing.id
        replaced += 1
      }
    }

    if (!replacementId) {
      try {
        const variant = await createVariant(scope, item.questionId, direction, {
          signal: options.signal,
          generate: options.generate,
        })
        replacementId = variant.id
        generated += 1
      } catch {
        // Difficulty limit, busy topic or model failure — the item keeps its
        // original question and the test version carries on.
        kept += 1
      }
      // Cancellation may have come mid model call — no point starting the next
      // item when nobody is waiting for the result.
      if (options.signal?.aborted) break
    }

    if (replacementId) {
      drop(item.questionId)
      add(replacementId)
      const snapshots = await buildQuestionSnapshots(scope, [replacementId])
      await db
        .update(testItems)
        .set({ questionId: replacementId, questionSnapshot: snapshots.get(replacementId) ?? null })
        .where(and(inSchool(scope, testItems), eq(testItems.id, item.id)))
    }

    done += 1
    options.onProgress?.(done, total)
  }

  return { testId: copy.id, replaced, generated, kept }
}
