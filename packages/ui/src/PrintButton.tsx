'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { BusyButton } from './BusyButton'
import { printPdf } from './print'

/** Tlačítko, které pošle PDF rovnou do tisku. */
export function PrintButton({
  href,
  children = 'Vytisknout',
  size = 'sm',
  variant = 'outline',
}: {
  href: string
  children?: ReactNode
  size?: 'sm' | 'default' | 'lg'
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary'
}) {
  const [preparing, setPreparing] = useState(false)

  async function handleClick() {
    setPreparing(true)
    try {
      await printPdf(href)
    } finally {
      setPreparing(false)
    }
  }

  return (
    <BusyButton
      size={size}
      variant={variant}
      busy={preparing}
      busyLabel="Připravuji tisk…"
      onClick={() => void handleClick()}
    >
      {children}
    </BusyButton>
  )
}
