import type { QueueCounts, QueueJob } from '@/lib/jobs'
import { requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

/**
 * Query keys and fetchers in one place, so components that show the same data
 * share one cache entry and one invalidation (`invalidateQueries({ queryKey: queryKeys.jobs.all })`).
 */
export const queryKeys = {
  jobs: {
    all: ['jobs'] as const,
    counts: ['jobs', 'counts'] as const,
    list: ['jobs', 'list'] as const,
  },
  library: {
    search: (needle: string) => ['library', 'search', needle] as const,
  },
}

export type JobCounts = Pick<QueueCounts, 'queued' | 'running' | 'error'> & { topicId?: string }

/** Counts for the toolbar indicator. */
export async function fetchJobCounts(): Promise<JobCounts> {
  const data = await requestJson<JobCounts>('/api/jobs', undefined, t('generation:queue.loadFailed'))
  return { running: data.running ?? 0, queued: data.queued ?? 0, error: data.error ?? 0, topicId: data.topicId }
}

export interface JobList {
  counts: QueueCounts
  jobs: QueueJob[]
}

/** The whole generation overview. */
export async function fetchJobList(): Promise<JobList> {
  const data = await requestJson<QueueCounts & { jobs: QueueJob[] }>(
    '/api/jobs?vypis=1',
    undefined,
    t('generation:queue.loadFailed'),
  )
  const { jobs = [], ...counts } = data
  return { counts: counts as QueueCounts, jobs }
}
