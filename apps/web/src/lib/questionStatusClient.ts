'use client'

import type { QuestionStatus } from '@testmaker/core/schema'
import { planUndo } from '@testmaker/ui'

/**
 * Smazání otázky je jen změna stavu na `rejected` — otázka zmizí ze seznamů
 * i z výběru do testu, ale dá se vrátit. Uložené testy ji tisknou dál ze
 * svého snímku, takže je smazání nepoškodí.
 */
async function writeStatus(ids: string[], status: QuestionStatus): Promise<void> {
  if (ids.length === 0) return
  const response = await fetch('/api/questions', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids, status }),
  })
  if (!response.ok) throw new Error('Změnu se nepodařilo uložit. Zkus to prosím znovu.')
}

/** Smaže otázky a vrátí jejich stavy před smazáním (pro „Vrátit zpět"). */
export async function rejectQuestions(
  questions: { id: string; status: QuestionStatus }[],
): Promise<[string, QuestionStatus][]> {
  const previous = questions.map((q): [string, QuestionStatus] => [q.id, q.status])
  await writeStatus(questions.map((q) => q.id), 'rejected')
  return previous
}

/** Vrátí otázkám stavy, které měly před smazáním (mohly se lišit). */
export async function restoreStatuses(previous: [string, QuestionStatus][]): Promise<void> {
  for (const step of planUndo(previous)) await writeStatus(step.ids, step.status)
}
