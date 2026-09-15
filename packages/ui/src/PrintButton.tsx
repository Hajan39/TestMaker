'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { printPdf } from './print'
import { Button } from './ui/button'

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
    <Button size={size} variant={variant} disabled={preparing} onClick={() => void handleClick()}>
      {preparing ? 'Připravuji tisk…' : children}
    </Button>
  )
}
