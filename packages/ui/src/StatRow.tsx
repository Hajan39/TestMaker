import { cn } from './cn'

export interface Stat {
  value: number | string
  label: string
  tone?: 'default' | 'draft'
}

/** Řádek s počty pod nadpisem obrazovky. */
export function StatRow({ items }: { items: Stat[] }) {
  return (
    <dl className="flex gap-6 border-y border-line-soft py-2.5">
      {items.map((item) => (
        <div key={item.label}>
          <dd
            className={cn(
              'ui-numeric text-[17px] font-bold tracking-tight',
              item.tone === 'draft' ? 'text-draft-fg' : 'text-fg',
            )}
          >
            {item.value}
          </dd>
          <dt className="text-[10.5px] text-fg-muted">{item.label}</dt>
        </div>
      ))}
    </dl>
  )
}
