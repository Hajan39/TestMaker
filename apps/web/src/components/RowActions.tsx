'use client'

import type { ReactNode } from 'react'
import { Loader2, MoreVertical } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * The single pattern for row actions: a three-dots button with a menu.
 *
 * Every list used to do actions differently — the bank had two text links side
 * by side ("Upravit" looked as harmless as "Nahradit modelem", which overwrites
 * a finished question), the tests list a three-dots menu, the library bare
 * icons. Accidentally clicking something that overwrites or deletes was only
 * possible in the first case — so the menu won: it has to be opened first and
 * shows the action's name and that it's irreversible (red item).
 *
 * `busy` replaces the button with a label of what's happening: the menu
 * closes after the click, so there's nowhere in it to show the wait.
 */
export function RowActions({
  label = t('library:rowActions.label'),
  busy = null,
  triggerRef,
  children,
}: {
  /** Button label for screen readers; on cards it's worth adding the item's name. */
  label?: string
  busy?: string | null
  /**
   * Ref to the button itself. After choosing "Upravit" the menu returns focus
   * here on its own — but if an editor (dialog) opens in the same tick, this
   * step steals focus from it and after closing the dialog (Escape) focus ends
   * up on `<body>`. Whoever opens the dialog keeps the button via the ref and
   * focuses it after closing.
   */
  triggerRef?: React.Ref<HTMLButtonElement>
  children: ReactNode
}) {
  if (busy) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-soft"
      >
        <Loader2 className="size-3.5 animate-spin" />
        {busy}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} size="icon-sm" variant="ghost" aria-label={label}>
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}
