import { t } from '@testmaker/core/i18n'

/**
 * How a queue run ended. Computed in two places (generation overview and the
 * bulk generation panel), which used to report it differently — one collected
 * errors, the other dropped them and showed a green "Hotovo" after seven failed
 * topics. So the sentence and its tone are built here, once.
 */
export interface QueueRun {
  /** How many topics the run actually processed (successful and failed). */
  processed: number
  /** How many of them ended with an error. */
  errors: number
  /** How many questions were created in total. */
  questions: number
}

/**
 * Tone of the result. Matches the kind of message: everything worked, something
 * failed, everything failed, or nothing happened at all.
 */
export type RunTone = 'success' | 'warning' | 'error' | 'empty'

export interface RunSummary {
  tone: RunTone
  text: string
}

/**
 * Sentence about a queue run's result. Counted one way — how many topics
 * succeeded and how many didn't; "done × remaining" in one sentence contradicted itself.
 */
export function runSummary({ processed, errors, questions }: QueueRun): RunSummary {
  if (processed === 0) {
    return { tone: 'empty', text: t('generation:queueSummary.empty') }
  }
  const succeeded = Math.max(0, processed - errors)
  const unfinished = t('generation:queueSummary.unfinished', { topics: t('library:count.topics', { count: errors }) })
  if (succeeded === 0) {
    return { tone: 'error', text: `${t('generation:queueSummary.allFailed')} ${unfinished}` }
  }
  const done = t('generation:queueSummary.done', {
    questions: t('library:count.questions', { count: questions }),
    topics: t('library:count.topicsGenitive', { count: succeeded }),
  })
  if (errors === 0) return { tone: 'success', text: done }
  return { tone: 'warning', text: `${done} ${unfinished}` }
}
