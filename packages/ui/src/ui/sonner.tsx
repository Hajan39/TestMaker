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
 * Toasts. Unlike the shadcn default there is no `next-themes` here: dark mode
 * is driven by the `dark` class on the root element and colours come from the
 * design tokens, so the toast recolours itself and no `theme` prop is needed.
 * With `theme="system"` Sonner would also override the teacher's choice from
 * the toggle in the bar.
 *
 * The variables are named `--color-*`: Tailwind 4 emits `@theme` tokens under
 * that name, whereas shadcn generates `var(--popover)`, which would not resolve
 * here and the toast would stay transparent.
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
          // The toast button ("Vzít zpět") must be visible in both modes,
          // hence the brand colour from tokens, not the default inverted tint.
          actionButton: '!bg-brand !text-brand-fg',
          cancelButton: '!bg-surface-muted !text-fg-soft',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
