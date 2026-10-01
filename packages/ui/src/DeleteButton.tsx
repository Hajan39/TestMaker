'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog'
import { Trash2 } from 'lucide-react'
import { t } from '@testmaker/core/i18n'
import { Button } from './ui/button'
import { Delayed, LoadingLines } from './Loading'

/**
 * Button for an irreversible action. It always asks for confirmation and the
 * description shows exactly what will disappear — deleting in the library
 * cascades and the teacher must see the impact before confirming.
 *
 * `describe` is called only on open, so the impact is looked up only when
 * someone actually wants it.
 */
export function DeleteButton({
  label,
  title,
  description,
  describe,
  confirmLabel,
  iconOnly = false,
  size = 'sm',
  variant = 'ghost',
  onConfirm,
}: {
  label?: ReactNode
  title: string
  description?: ReactNode
  describe?: () => Promise<ReactNode>
  confirmLabel?: string
  /**
   * Just a trash icon with a hover tooltip. Useful where each item has several
   * actions and texts would drown out what matters — the names.
   */
  iconOnly?: boolean
  size?: 'sm' | 'default' | 'lg' | 'icon-sm'
  variant?: 'ghost' | 'outline' | 'destructive'
  onConfirm: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<ReactNode>(null)

  async function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next && describe) {
      setDetail(null)
      setDetail(await describe())
    }
  }

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => void handleOpenChange(next)}>
      <AlertDialogTrigger asChild>
        {/*
          Red text belongs only on a neutral background (`ghost`, `outline`).
          The `destructive` variant has a red background and light text of its
          own — forcing the text colour would give red on red and hide the label.
        */}
        <Button
          size={iconOnly ? 'icon-sm' : size}
          variant={variant}
          aria-label={iconOnly ? title : undefined}
          title={iconOnly ? title : undefined}
          className={variant === 'destructive' ? undefined : 'text-danger hover:text-danger'}
        >
          {iconOnly ? <Trash2 aria-hidden /> : (label ?? t('actions.delete'))}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {description ? <p>{description}</p> : null}
              {/* Until the impact is known a skeleton holds its place: a
                  "Zjišťuji…" text was a line shorter than the listing and the
                  delete button jumped exactly when someone was aiming at it. */}
              {describe
                ? (detail ?? (
                    <Delayed label={t('ui:deleteButton.findingImpact')}>
                      <LoadingLines lines={2} />
                    </Delayed>
                  ))
                : null}
              <p className="text-fg-muted">{t('ui:deleteButton.irreversible')}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={(event) => {
              event.preventDefault()
              void confirm()
            }}
          >
            {busy ? t('actions.deleting') : (confirmLabel ?? t('actions.delete'))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
