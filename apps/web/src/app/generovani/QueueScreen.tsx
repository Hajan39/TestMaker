'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  Badge,
  BusyButton,
  Button,
  Card,
  DeleteButton,
  EmptyState,
  StatRow,
  toast,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { drainQueue } from '@/lib/generateClient'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import type { QueueCounts, QueueJob } from '@/lib/jobs'
import { runSummary } from '@/lib/queueSummary'

/** How often the screen polls for progress. Only while something is happening. */
const REFRESH_MS = 3000

interface QueueData {
  counts: QueueCounts
  jobs: QueueJob[]
}

/**
 * Generation overview.
 *
 * Polls only when there is something to wait for: while anything runs or is
 * queued it refreshes every three seconds, and stops once done. The screen can
 * also drive the generation itself — the queue is processed one topic at a time
 * and doesn't move without an open window.
 */
export function QueueScreen({
  initialJobs,
  initialCounts,
  aiConfigured,
}: {
  initialJobs: QueueJob[]
  initialCounts: QueueCounts
  aiConfigured: boolean
}) {
  const router = useRouter()
  const [data, setData] = useState<QueueData>({ counts: initialCounts, jobs: initialJobs })
  const [working, setWorking] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const stopRef = useRef(false)

  const { counts, jobs } = data
  const busy = counts.running > 0 || counts.queued > 0

  const refresh = useCallback(async () => {
    // One failed request doesn't matter — the overview stays as it was and the
    // next request three seconds later catches up. A message would just flicker.
    try {
      const response = await fetch('/api/jobs?vypis=1')
      if (!response.ok) return
      const next = (await response.json()) as QueueCounts & { jobs: QueueJob[] }
      setData({ counts: next, jobs: next.jobs })
    } catch {
      // See above.
    }
  }, [])

  // The queue is processed only with the page open — closing or reloading
  // stops it, so the browser asks first.
  useEffect(() => {
    if (!working) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [working])

  // Polling forever would be pointless — when nothing waits or runs, the
  // overview won't change by itself.
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [busy, refresh])

  async function run() {
    setWorking(true)
    stopRef.current = false
    let created = 0
    let done = 0
    let failed = 0
    try {
      await drainQueue(
        (step) => {
          // The last request on an empty queue processes no topic — only real
          // steps count, otherwise the summary would report one topic too many.
          if (!step.processed) return
          done += 1
          created += step.created ?? 0
          if (step.error) failed += 1
          void refresh()
        },
        () => stopRef.current,
      )
      // Per-topic errors used to be dropped and a green "Hotovo" showed after
      // seven failed topics. The result now decides the tone.
      const summary = runSummary({ processed: done, errors: failed, questions: created })
      const message =
        summary.tone === 'error' ? toast.error : summary.tone === 'warning' ? toast.warning : toast.success
      message(summary.text, {
        duration: 12_000,
        // Library-wide draft review was removed — approving now happens in the
        // topic, and a bulk run touches several at once, so the link goes to the
        // tiles of all classes (`?vse=1` — otherwise the home page would redirect
        // to the last opened class), from where each topic is a click away.
        action: created > 0 ? { label: t('generation:queue.review'), onClick: () => router.push('/?vse=1') } : undefined,
      })
    } catch (error) {
      toast.error(errorMessage(error, t('generation:queue.runStopped')))
    } finally {
      setWorking(false)
      await refresh()
      router.refresh()
    }
  }

  async function retry(ids?: string[]) {
    setRetrying(true)
    try {
      const result = await requestJson<{ requeued: number }>(
        '/api/jobs/retry',
        jsonBody('POST', ids ? { ids } : {}),
        t('generation:queue.retryFailed'),
      )
      const requeued = result.requeued ?? 0
      toast.success(
        requeued > 0
          ? t('generation:queue.requeued', { topics: t('library:count.topics', { count: requeued }) })
          : t('generation:queue.nothingToRequeue'),
      )
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('generation:queue.retryFailed')))
    } finally {
      setRetrying(false)
    }
  }

  async function clear(scope: 'cekajici' | 'vse') {
    // The error bubbles up — `DeleteButton` then keeps the dialog open
    // and doesn't pretend a success that didn't happen.
    try {
      await requestJson(`/api/jobs?rozsah=${scope}`, { method: 'DELETE' }, t('generation:queue.clearFailed'))
    } catch (error) {
      toast.error(errorMessage(error, t('generation:queue.clearFailed')))
      throw error
    }
    stopRef.current = true
    toast.success(scope === 'vse' ? t('generation:queue.overviewCleared') : t('generation:queue.queueCleared'))
    await refresh()
    router.refresh()
  }

  const running = jobs.filter((job) => job.status === 'running')
  const waiting = jobs.filter((job) => job.status === 'queued')
  const failed = jobs.filter((job) => job.status === 'error')
  const finished = jobs.filter((job) => job.status === 'done')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="ui-page-title">{t('generation:queue.title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('generation:queue.intro')}</p>
      </div>

      <StatRow
        items={[
          { value: counts.running, label: t('generation:queue.stats.running') },
          { value: counts.queued, label: t('generation:queue.stats.queued') },
          { value: counts.error, label: t('generation:queue.stats.error'), tone: counts.error > 0 ? 'draft' : 'default' },
          { value: counts.done, label: t('generation:queue.stats.done') },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        {aiConfigured && counts.queued > 0 ? (
          working ? (
            <Button variant="destructive" size="sm" onClick={() => (stopRef.current = true)}>
              {t('generation:queue.stop')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void run()}>
              {t('generation:queue.run')}
            </Button>
          )
        ) : null}
        {working ? (
          <span className="text-sm text-fg-soft">{t('generation:queue.working')}</span>
        ) : null}
        {counts.error > 0 ? (
          <BusyButton
            size="sm"
            variant="outline"
            busy={retrying}
            busyLabel={t('generation:queue.requeueing')}
            onClick={() => void retry()}
          >
            {t('generation:queue.retryAll')}
          </BusyButton>
        ) : null}
        {counts.queued + counts.running + counts.error > 0 ? (
          <DeleteButton
            label={t('generation:queue.clearQueue.label')}
            title={t('generation:queue.clearQueue.title')}
            description={t('generation:queue.clearQueue.description')}
            confirmLabel={t('generation:queue.clearQueue.confirm')}
            onConfirm={() => clear('cekajici')}
          />
        ) : null}
        {counts.done > 0 ? (
          <DeleteButton
            label={t('generation:queue.clearAll.label')}
            title={t('generation:queue.clearAll.title')}
            description={t('generation:queue.clearAll.description')}
            confirmLabel={t('generation:queue.clearAll.confirm')}
            onConfirm={() => clear('vse')}
          />
        ) : null}
      </div>

      {/* The run condition belongs next to the button, not only in the intro:
          leaving the page stops the work and that must be known before clicking. */}
      {aiConfigured && counts.queued > 0 ? (
        <p className="-mt-3 text-sm text-fg-muted">{t('generation:queue.keepOpen')}</p>
      ) : null}

      {jobs.length === 0 ? (
        <EmptyState
          title={t('generation:queue.empty.title')}
          hint={t('generation:queue.empty.hint')}
          action={
            <Link href="/">
              <Button size="sm" variant="outline">
                {t('generation:queue.empty.action')}
              </Button>
            </Link>
          }
        />
      ) : null}

      {/* Counts are read in one place — the stat row on top. Sections render
          only when non-empty, so a number in the heading would just repeat it;
          for finished jobs it would even lie, since only the last few are listed. */}
      <Section title={t('generation:queue.sections.running')} jobs={running} />
      <Section title={t('generation:queue.sections.queued')} jobs={waiting} />
      <Section
        title={t('generation:queue.sections.error')}
        jobs={failed}
        onRetry={(id) => void retry([id])}
        retrying={retrying}
      />
      <Section
        title={
          counts.done > finished.length
            ? t('generation:queue.sections.doneLast', { count: finished.length })
            : t('generation:queue.sections.done')
        }
        jobs={finished}
      />
    </div>
  )
}

function Section({
  title,
  jobs,
  onRetry,
  retrying,
}: {
  title: string
  jobs: QueueJob[]
  onRetry?: (id: string) => void
  retrying?: boolean
}) {
  if (jobs.length === 0) return null
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <ul className="mt-2 divide-y divide-line-soft">
        {jobs.map((job) => (
          <li key={job.id} data-job-id={job.id} className="flex flex-wrap items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <Link href={`/topics/${job.topicId}`} className="text-sm font-medium text-fg hover:text-brand">
                {job.topicName}
              </Link>
              {job.place ? <p className="text-xs text-fg-muted">{job.place}</p> : null}
              {job.error ? <p className="mt-1 text-sm text-danger">{job.error}</p> : null}
            </div>
            {/* On a narrow screen the right group wraps below the topic name
                instead of overflowing the card — `main` hides horizontal
                scrolling, so a button past the edge would be unreachable. */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-xs text-fg-muted">{describe(job)}</span>
              <StateBadge status={job.status} />
              {onRetry ? (
                <Button size="sm" variant="outline" disabled={retrying} onClick={() => onRetry(job.id)}>
                  {t('common:actions.retry')}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * State badge. Brand green belongs to actions, not states, so states differ by
 * word and only the unfinished one takes the drafts' warning colour — it's the
 * only state the teacher has to act on.
 */
function StateBadge({ status }: { status: QueueJob['status'] }) {
  if (status === 'running') {
    return (
      <Badge variant="status">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {t('generation:queue.badge.running')}
      </Badge>
    )
  }
  if (status === 'queued') return <Badge variant="status">{t('generation:queue.badge.queued')}</Badge>
  if (status === 'error') return <Badge className="bg-draft-bg text-draft-fg">{t('generation:queue.badge.error')}</Badge>
  return <Badge variant="status">{t('generation:queue.badge.done')}</Badge>
}

/** What can be said about a job in one short phrase right of the topic name. */
function describe(job: QueueJob): string {
  if (job.status === 'running') {
    return job.startedAt ? t('generation:queue.describe.runningFor', { duration: sinceText(job.startedAt) }) : t('generation:queue.describe.starting')
  }
  if (job.status === 'queued') {
    return job.wanted
      ? t('generation:queue.describe.planned', { questions: t('library:count.questions', { count: job.wanted }) })
      : t('generation:queue.describe.waiting')
  }
  if (job.status === 'error') {
    return job.createdCount > 0
      ? t('generation:queue.describe.partlyCreated', { questions: t('library:count.questions', { count: job.createdCount }) })
      : t('generation:queue.describe.noneCreated')
  }
  return t('library:count.questions', { count: job.createdCount })
}

/**
 * How long something has been running, without seconds: "chvíli", "3 minuty", "2 hodiny".
 * Precision helps nobody here; the point is telling a stuck job from a fresh one.
 */
export function sinceText(from: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(from).getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return t('generation:queue.since.moment')
  if (minutes < 60) return t('generation:queue.since.minutes', { count: minutes })
  return t('generation:queue.since.hours', { count: Math.floor(minutes / 60) })
}
