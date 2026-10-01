'use client'

import { useCallback, useEffect, useState } from 'react'
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

interface Counts {
  running: number
  queued: number
  /** Unfinished topics. They stay around even a day after the model quota ran out. */
  error: number
  /** Topic of the only running or queued job, when nothing failed. */
  topicId?: string
}

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
  const [counts, setCounts] = useState<Counts>({ running: 0, queued: 0, error: 0 })
  const busy = counts.running > 0 || counts.queued > 0

  /**
   * Reads the counts. State is set in response to the result, not inside the
   * effect body — otherwise it re-renders in circles.
   */
  const readCounts = useCallback(async (): Promise<Counts | null> => {
    try {
      const response = await fetch('/api/jobs')
      if (!response.ok) return null
      const data = (await response.json()) as Partial<Counts>
      return {
        running: data.running ?? 0,
        queued: data.queued ?? 0,
        error: data.error ?? 0,
        topicId: data.topicId,
      }
    } catch {
      // The toolbar indicator is optional; if it fails to load, nothing happens.
      return null
    }
  }, [])

  // Once on every page navigation — and right when generation starts somewhere.
  useEffect(() => {
    let valid = true
    const load = () => {
      void readCounts().then((next) => {
        if (valid && next) setCounts(next)
      })
    }

    load()
    window.addEventListener(GENERATION_STARTED, load)
    // Polls repeatedly only while running. While nothing generates, nothing can change.
    const timer = busy ? setInterval(load, REFRESH_MS) : null
    return () => {
      valid = false
      window.removeEventListener(GENERATION_STARTED, load)
      if (timer) clearInterval(timer)
    }
  }, [pathname, busy, readCounts])

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
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {text}
    </Link>
  )
}
