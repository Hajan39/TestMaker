'use client'

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Hlášky (toasty). Oproti výchozí podobě ze shadcn tu není `next-themes`:
 * tmavý režim u nás řídí třída `dark` na kořenovém elementu a barvy se berou
 * z designových tokenů, takže se hláška přebarví sama a žádný `theme` prop
 * není potřeba. Sonner by si s `theme="system"` navíc přebil volbu učitelky
 * z přepínače v liště.
 *
 * Proměnné se jmenují `--color-*`: Tailwind 4 vypouští tokeny z `@theme`
 * pod tímhle jménem, kdežto shadcn generuje `var(--popover)`, což by se tu
 * nerozřešilo a hláška by zůstala průhledná.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--color-popover)',
          '--normal-text': 'var(--color-popover-foreground)',
          '--normal-border': 'var(--color-border)',
          '--border-radius': 'var(--radius-outer)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Tlačítko v hlášce („Vzít zpět“) musí být vidět na obou režimech,
          // proto značková barva z tokenů, ne výchozí inverzní podbarvení.
          actionButton: '!bg-brand !text-brand-fg',
          cancelButton: '!bg-surface-muted !text-fg-soft',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
