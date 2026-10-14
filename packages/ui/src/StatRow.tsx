import { cn } from './cn'

export interface Stat {
  /** Stable key for tests: rendered as `data-testid="stat-<id>"`. */
  id?: string
  value: number | string
  label: string
  tone?: 'default' | 'draft'
}

/** Stats row below a screen heading. */
export function StatRow({ items }: { items: Stat[] }) {
  return (
    <dl className="flex gap-6 border-y border-line-soft py-2.5">
      {items.map((item) => (
        // `dt` comes first in the DOM (valid `dl`, label read before value);
        // `flex-col-reverse` keeps the value visually on top.
        <div
          key={item.label}
          className="flex flex-col-reverse"
          data-testid={item.id ? `stat-${item.id}` : undefined}
        >
          <dt className="text-xs text-fg-muted">{item.label}</dt>
          <dd
            className={cn(
              'ui-numeric text-lg font-bold tracking-tight',
              item.tone === 'draft' ? 'text-draft-fg' : 'text-fg',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
