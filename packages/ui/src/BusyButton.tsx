'use client'

import type { ComponentProps } from 'react'
import { Button } from './ui/button'

/**
 * Tlačítko akce, která chvíli trvá. Po dobu běhu je zablokované a říká, co
 * dělá („Ukládám…“, „Mažu…“) — jinak není poznat, jestli se kliknutí vůbec
 * chytlo, a učitelka klikne podruhé.
 *
 * Bez kolečka schválně: popisek řekne víc a tlačítko nezmění výšku. Kostra se
 * sem nehodí — nečeká se na obsah, který by se měl objevit, ale na akci.
 */
export function BusyButton({
  busy = false,
  busyLabel,
  disabled,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  busy?: boolean
  /** Co tlačítko říká, dokud akce běží. */
  busyLabel: string
}) {
  return (
    <Button {...props} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? busyLabel : children}
    </Button>
  )
}
