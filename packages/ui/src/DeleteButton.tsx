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
import { Button } from './ui/button'
import { Delayed, LoadingLines } from './Loading'

/**
 * Tlačítko pro nevratnou akci. Potvrzení se ptá vždy a v popisu ukazuje,
 * co přesně zmizí — mazání v knihovně je kaskádové a učitelka musí vidět
 * dopad dřív, než ho potvrdí.
 *
 * `describe` se volá až při otevření, aby se dopad zjišťoval jen tehdy,
 * když o něj někdo stojí.
 */
export function DeleteButton({
  label = 'Smazat',
  title,
  description,
  describe,
  confirmLabel = 'Smazat',
  size = 'sm',
  variant = 'ghost',
  onConfirm,
}: {
  label?: ReactNode
  title: string
  description?: ReactNode
  describe?: () => Promise<ReactNode>
  confirmLabel?: string
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
        <Button size={size} variant={variant} className="text-danger hover:text-danger">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {description ? <p>{description}</p> : null}
              {/* Dokud dopad neznáme, drží jeho místo kostra: text „Zjišťuji…“
                  byl o řádek kratší než výpis a tlačítko Smazat pak poskočilo
                  přesně ve chvíli, kdy na něj někdo mířil myší. */}
              {describe
                ? (detail ?? (
                    <Delayed label="Zjišťuji, co zmizí…">
                      <LoadingLines lines={2} />
                    </Delayed>
                  ))
                : null}
              <p className="text-fg-muted">Akci nejde vrátit zpět.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Zrušit</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={(event) => {
              event.preventDefault()
              void confirm()
            }}
          >
            {busy ? 'Mažu…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
