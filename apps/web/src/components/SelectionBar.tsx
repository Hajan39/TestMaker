'use client'

import { BusyButton, Button } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * Bar at the bottom of the screen with the questions picked for a new test
 * (`QuestionCart`): how many, from how many topics and how many points, with
 * a button to create a test from them.
 *
 * `surface-chrome`, because the bar is a control surface over the content,
 * not content itself — just like the top navigation.
 */
export function SelectionBar({
  count,
  points,
  topicCount = 1,
  busy,
  onCreate,
  onClear,
}: {
  count: number
  points: number
  /** How many topics the questions come from. */
  topicCount?: number
  busy: boolean
  onCreate: () => void
  onClear: () => void
}) {
  return (
    <div className="surface-chrome flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-inner)] border border-line bg-surface px-4 py-3">
      <span
        className="text-sm font-medium text-fg"
        data-testid="selection-bar"
        data-count={count}
        data-points={points}
        data-topics={topicCount}
      >
        {t('library:selectionBar.selected', { selected: count })} · {t('library:selectionBar.points', { count: points })}
        {topicCount > 1 ? (
          <span className="text-fg-muted"> · {t('library:selectionBar.topics', { count: topicCount })}</span>
        ) : null}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
          {t('library:selectionBar.clear')}
        </Button>
        <BusyButton size="sm" busy={busy} busyLabel={t('library:selectionBar.creating')} onClick={onCreate}>
          {t('library:selectionBar.createTest')}
        </BusyButton>
      </div>
    </div>
  )
}
