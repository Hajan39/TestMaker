'use client'

import { BusyButton, Button, plural } from '@testmaker/ui'

/**
 * Lepivá lišta dole nad seznamem otázek tématu: kolik jich je vybraných a
 * kolik dají dohromady bodů, s tlačítkem na založení testu rovnou z výběru.
 *
 * `surface-chrome`, protože lišta je ovládací plocha nad obsahem, ne obsah
 * sám — stejně jako horní navigace.
 */
export function SelectionBar({
  count,
  points,
  busy,
  onCreate,
  onClear,
}: {
  count: number
  points: number
  busy: boolean
  onCreate: () => void
  onClear: () => void
}) {
  return (
    <div className="surface-chrome sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-inner)] border border-line bg-surface px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <span className="text-sm font-medium text-fg">
        Vybráno {count} · {points} {plural(points, 'bod', 'body', 'bodů')}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
          Zrušit výběr
        </Button>
        <BusyButton size="sm" busy={busy} busyLabel="Vytvářím…" onClick={onCreate}>
          Vytvořit test
        </BusyButton>
      </div>
    </div>
  )
}
