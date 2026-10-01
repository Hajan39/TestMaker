import type { ReactNode } from 'react'
import { t } from '@testmaker/core/i18n'
import { cn } from './cn'

export interface NavListItem {
  id: string
  label: string
  count?: number
  /** The topic has unreviewed drafts. */
  flag?: boolean
}

/**
 * Sidebar list: item, count and a dot for unfinished work.
 * `renderItem` renders the wrapper of the whole row (typically a link) so the
 * whole row is clickable, not just the text — the count and dot are not a dead
 * zone. The active row carries `aria-current="page"` on that link.
 */
export function NavList({
  items,
  activeId,
  renderItem,
}: {
  items: NavListItem[]
  activeId?: string
  renderItem: (item: NavListItem, content: ReactNode, active: boolean) => ReactNode
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = item.id === activeId
        const content = (
          <span
            className={cn(
              'flex w-full items-center gap-1.5 rounded-[var(--radius-inner)] px-2 py-1 text-sm',
              active ? 'bg-brand-bg font-semibold text-brand' : 'text-fg-soft hover:bg-surface-muted',
            )}
          >
            {item.flag ? (
              <span
                aria-label={t('ui:navList.unreviewedDrafts')}
                className="size-1.5 shrink-0 rounded-full bg-draft-fg"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate" title={item.label}>
              {item.label}
            </span>
            {typeof item.count === 'number' ? (
              <span className={cn('ui-numeric text-xs', active ? 'text-brand/70' : 'text-fg-muted')}>
                {item.count}
              </span>
            ) : null}
          </span>
        )
        return <li key={item.id}>{renderItem(item, content, active)}</li>
      })}
    </ul>
  )
}
