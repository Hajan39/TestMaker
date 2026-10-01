'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Badge, Card, Tooltip, TooltipContent, TooltipTrigger } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { InlineName } from '@/components/InlineName'
import type { TopicJobState } from '@/lib/library'

/**
 * A topic tile in the grade overview. Names tend to be long and without spaces
 * (`prirodopis-6_pl-bezobratli-vztahy._test_2018`), so they are truncated and
 * the full text shows on hover.
 *
 * The tile has three rows, each with one job:
 *
 * 1. the name itself and the rename pencil — nothing more, so the grade
 *    overview can be scanned by names,
 * 2. numbers: how many materials and questions the topic has,
 * 3. badges: what is stuck in the topic.
 *
 * Badges used to sit next to the name and the numbers below repeated the same.
 * The name got truncated the sooner, the more was going on in the topic.
 */
export function TopicTile({
  id,
  name,
  materialCount,
  questionCount,
  lowContent,
  jobState,
  actions,
}: {
  id: string
  name: string
  materialCount: number
  questionCount: number
  /** Too little usable text for a test — see `MIN_USABLE_TOPIC_CHARS`. */
  lowContent?: boolean
  /** Generation queue state on the class page — not looked up elsewhere. */
  jobState?: TopicJobState
  /** Extra action on the topic (on the class page "Přesunout do…"). */
  actions?: ReactNode
}) {
  return (
    <Card className="gap-1.5 p-3 hover:border-brand">
      {/* Renaming belongs to the name, so it's inside the card, not next to it.
          The name is a link like the rest of the tile — clicking it used to do
          nothing; the pencil and the rename field stop the click themselves. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={`/topics/${id}`} className="flex min-w-0 items-center gap-1">
            <InlineName
              kind="topic"
              id={id}
              name={name}
              className="text-sm text-fg-soft"
              label={t('library:itemDialogs.topic.rename')}
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-md">
          {name}
        </TooltipContent>
      </Tooltip>

      <Link href={`/topics/${id}`} className="block">
        <p className="truncate text-xs text-fg-muted">
          {t('library:count.materials', { count: materialCount })}
          {questionCount > 0 ? ` · ${t('library:count.questions', { count: questionCount })}` : ''}
        </p>
      </Link>

      {questionCount === 0 || lowContent || jobState ? (
        <Link href={`/topics/${id}`} className="flex flex-wrap items-center gap-1">
          {jobState === 'running' ? (
            <Badge variant="status">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {t('library:topicTile.generating')}
            </Badge>
          ) : null}
          {jobState === 'queued' ? <Badge variant="status">{t('library:topicTile.queued')}</Badge> : null}
          {questionCount === 0 ? <Badge variant="status">{t('library:topicTile.noQuestions')}</Badge> : null}
          {lowContent ? <Badge variant="status">{t('library:topicTile.lowContent')}</Badge> : null}
        </Link>
      ) : null}

      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </Card>
  )
}
