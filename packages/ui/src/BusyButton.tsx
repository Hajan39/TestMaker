'use client'

import type { ComponentProps } from 'react'
import { Button } from './ui/button'

/**
 * Button for an action that takes a while. While running it is disabled and
 * says what it is doing ("Ukládám…", "Mažu…") — otherwise there is no telling
 * whether the click registered, and the teacher clicks again.
 *
 * No spinner on purpose: the label says more and the button keeps its height.
 * A skeleton does not fit here — we are waiting for an action, not for content.
 */
export function BusyButton({
  busy = false,
  busyLabel,
  disabled,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  busy?: boolean
  /** What the button says while the action runs. */
  busyLabel: string
}) {
  return (
    <Button {...props} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? busyLabel : children}
    </Button>
  )
}
