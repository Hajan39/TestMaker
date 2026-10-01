'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { t } from '@testmaker/core/i18n'
import { BusyButton } from './BusyButton'
import { printPdf } from './print'

/** Button that sends a PDF straight to the printer. */
export function PrintButton({
  href,
  children,
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('ui:print.failed'))
    } finally {
      setPreparing(false)
    }
  }

  return (
    <BusyButton
      size={size}
      variant={variant}
      busy={preparing}
      busyLabel={t('ui:print.preparing')}
      onClick={() => void handleClick()}
    >
      {children ?? t('actions.print')}
    </BusyButton>
  )
}
