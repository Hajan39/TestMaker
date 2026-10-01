/**
 * Undo plan for a bulk action.
 *
 * When the teacher approves or rejects dozens of questions at once, those
 * questions previously had different statuses — some were drafts, some already
 * approved. Undo therefore cannot send one status for all; it must restore them
 * in groups. This function builds such groups from the recorded previous
 * statuses.
 *
 * Deliberately a pure function without React or fetch: it is testable and the
 * caller does the server write itself.
 */

/** Question status as the question schema knows it. Copied here to keep the package dependency-free. */
export type UndoStatus = 'draft' | 'approved' | 'rejected'

export interface UndoStep<Status extends string = UndoStatus> {
  status: Status
  ids: string[]
}

/**
 * Groups ids by the status they should return to. The order of groups and of
 * ids within them follows the input, so the result is comparable in a test and
 * server writes happen in the order the teacher selected the questions.
 *
 * A duplicate id counts once — the first occurrence wins, because it carries
 * the status before the action; a later one might already be the status after.
 */
export function planUndo<Status extends string = UndoStatus>(
  previous: Iterable<readonly [string, Status]>,
): UndoStep<Status>[] {
  const steps: UndoStep<Status>[] = []
  const byStatus = new Map<Status, UndoStep<Status>>()
  const seen = new Set<string>()

  for (const [id, status] of previous) {
    if (seen.has(id)) continue
    seen.add(id)

    let step = byStatus.get(status)
    if (!step) {
      step = { status, ids: [] }
      byStatus.set(status, step)
      steps.push(step)
    }
    step.ids.push(id)
  }

  return steps
}
