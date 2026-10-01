'use client'

import type { QuestionStatus } from '@testmaker/core/schema'
import { planUndo } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * Deleting a question only changes its status to `rejected` — it disappears
 * from the lists and from test selection, but can be restored. Saved tests
 * keep printing it from their snapshot, so deleting does not break them.
 */
async function writeStatus(ids: string[], status: QuestionStatus): Promise<void> {
  if (ids.length === 0) return
  const response = await fetch('/api/questions', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids, status }),
  })
  if (!response.ok) throw new Error(t('library:questionStatus.saveFailed'))
}

/** Deletes questions and returns their statuses from before the deletion (for „Vrátit zpět"). */
export async function rejectQuestions(
  questions: { id: string; status: QuestionStatus }[],
): Promise<[string, QuestionStatus][]> {
  const previous = questions.map((q): [string, QuestionStatus] => [q.id, q.status])
  await writeStatus(questions.map((q) => q.id), 'rejected')
  return previous
}

/** Restores the statuses questions had before deletion (they may have differed). */
export async function restoreStatuses(previous: [string, QuestionStatus][]): Promise<void> {
  for (const step of planUndo(previous)) await writeStatus(step.ids, step.status)
}
