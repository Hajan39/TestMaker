'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJobCounts, queryKeys, type JobCounts } from '@/lib/queries'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { t } from '@testmaker/core/i18n'

/** How often the toolbar polls generation progress. Only while something is happening. */
const REFRESH_MS = 5000

/**
 * Event the app fires when a generation has just started. Thanks to it the
 * toolbar responds immediately, even without navigation.
 */
export const GENERATION_STARTED = 'testmaker:generation'

/** Tells the toolbar that new work has started. */
export function announceGeneration(): void {
  window.dispatchEvent(new Event(GENERATION_STARTED))
}

/** `error` = unfinished topics; they stay around even a day after the model quota ran out. */
type Counts = JobCounts

/**
 * A quiet note in the top toolbar: generation is running and how many topics
 * it still concerns. Links to the generation overview, so one can leave the
 * topic and still know how it goes.
 *
 * It stays after finishing if some topic remained unfinished — with a different,
 * calm sentence and no spinner. That's exactly when the overview is needed most:
 * the most common reason for stopping is an exhausted daily model quota and the
 * teacher returns to the unfinished work the next day, when nothing runs anymore.
 *
 * Polls sparingly: once on every page navigation, and further only when
 * something is really happening.
 */
export function GenerationStatus({ pathname }: { pathname: string }) {
  const queryClient = useQueryClient()
  const { data, refetch } = useQuery({
    queryKey: queryKeys.jobs.counts,
    queryFn: fetchJobCounts,
    // Polls only while something runs or waits — otherwise nothing can change by itself.
    refetchInterval: (query) => {
      const current = query.state.data
      return current && current.running + current.queued > 0 ? REFRESH_MS : false
    },
  })
  // The indicator is optional: until the first answer (or when it fails) it stays empty.
  const counts: Counts = data ?? { running: 0, queued: 0, error: 0 }
  const busy = counts.running > 0 || counts.queued > 0

  // Once on every page navigation — and right when generation starts somewhere.
  useEffect(() => {
    void refetch()
  }, [pathname, refetch])
  useEffect(() => {
    const started = () => void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all })
    window.addEventListener(GENERATION_STARTED, started)
    return () => window.removeEventListener(GENERATION_STARTED, started)
  }, [queryClient])

  if (!busy && counts.error === 0) return null

  // Three sentences for three situations: something is being created, something
  // waits in line, or nothing happens and only unfinished topics remain.
  const text = busy
    ? counts.running > 0
      ? counts.queued > 0
        ? t('generation:generationStatus.runningWithQueue', { topics: t('library:count.topics', { count: counts.queued }) })
        : t('generation:generationStatus.running')
      : t('generation:generationStatus.queued', { topics: t('library:count.topics', { count: counts.queued }) })
    : t('generation:generationStatus.unfinished', { count: counts.error })

  // Exactly one topic and nothing failed: the indicator leads straight into it,
  // not to the generic overview from where one would have to click further.
  const href = counts.topicId ? `/topics/${counts.topicId}` : '/generovani'

  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-[var(--radius-inner)] px-2 py-1 text-xs text-fg-muted hover:text-fg"
      title={counts.topicId ? t('generation:generationStatus.openTopic') : t('generation:generationStatus.overview')}
    >
      {/* The spinner belongs only to work that really runs. For unfinished
          topics it would spin over something that stands still. */}
      {/* Only real work spins — a queue nobody is running waits, it does not work. */}
      {counts.running > 0 ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {text}
    </Link>
  )
}
