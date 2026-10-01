'use client'

import { BusyButton, Button } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * Sticky bar below the topic's question list: how many are selected and how
 * many points they add up to, with a button to create a test straight from
 * the selection.
 *
 * `surface-chrome`, because the bar is a control surface over the content,
 * not content itself — just like the top navigation.
 */
export function SelectionBar({
  count,
  points,
  hiddenCount = 0,
  busy,
  onCreate,
  onClear,
}: {
  count: number
  points: number
  /** How many of the selected questions the current list filter hides. */
  hiddenCount?: number
  busy: boolean
  onCreate: () => void
  onClear: () => void
}) {
  return (
    <div className="surface-chrome sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-inner)] border border-line bg-surface px-4 py-3">
      <span className="text-sm font-medium text-fg">
        {t('library:selectionBar.selected', { selected: count })} · {t('library:selectionBar.points', { count: points })}
        {hiddenCount > 0 ? (
          <span className="text-fg-muted"> {t('library:selectionBar.hiddenByFilter', { count: hiddenCount })}</span>
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
