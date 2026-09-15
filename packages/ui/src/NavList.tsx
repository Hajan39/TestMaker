import type { ReactNode } from 'react'
import { cn } from './cn'

export interface NavListItem {
  id: string
  label: string
  count?: number
  /** Téma má nezkontrolované koncepty. */
  flag?: boolean
}

/** Seznam v postranním panelu: položka, počet a tečka u nedodělků. */
export function NavList({
  items,
  activeId,
  renderItem,
}: {
  items: NavListItem[]
  activeId?: string
  renderItem: (item: NavListItem) => ReactNode
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <li
            key={item.id}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-[var(--radius-inner)] px-2 py-1 text-sm',
              active ? 'bg-brand-bg font-semibold text-brand' : 'text-fg-soft hover:bg-surface-muted',
            )}
          >
            {item.flag ? (
              <span
                aria-label="Čekají nezkontrolované koncepty"
                className="size-1.5 shrink-0 rounded-full bg-draft-fg"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{renderItem(item)}</span>
            {typeof item.count === 'number' ? (
              <span className={cn('ui-numeric text-xs', active ? 'text-brand/70' : 'text-fg-muted')}>
                {item.count}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
