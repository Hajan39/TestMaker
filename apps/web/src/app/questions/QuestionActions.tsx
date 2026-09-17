'use client'

import { useState } from 'react'
import type { Question } from '@testmaker/core/schema'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenuItem,
  toast,
} from '@testmaker/ui'
import { RowActions } from '@/components/RowActions'
import { useRegenerateQuestion } from '@/components/useRegenerateQuestion'

/**
 * Akce u jedné otázky v bance — v jediné nabídce pod třemi tečkami, stejně
 * jako u testů.
 *
 * Dřív byly v řádku dva textové odkazy vedle sebe a „Nahradit modelem"
 * vypadalo stejně neškodně jako „Upravit", přitom hotovou otázku přepíše.
 * V nabídce se na ně nedá kliknout omylem a nevratné mazání je v ní vidět
 * červeně, ne schované v hromadné liště.
 */
export function QuestionActions({
  question,
  label,
  onEdit,
  onChanged,
}: {
  question: Question
  /** Zadání otázky do popisku tlačítka — na kartě je nabídek pod sebou víc. */
  label: string
  /** Otevře editor; chybí u otázky bez tématu, ta se upravovat nedá. */
  onEdit: (() => void) | null
  /** Zavolá se po náhradě nebo smazání — seznam se má obnovit. */
  onChanged: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const regenerate = useRegenerateQuestion(question.id, question.type, onChanged)

  async function remove() {
    setDeleting(true)
    try {
      const response = await fetch(`/api/questions?id=${encodeURIComponent(question.id)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        toast.error('Otázku se nepodařilo smazat')
        return
      }
      setConfirmOpen(false)
      toast.success('Otázka smazána')
      onChanged()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <RowActions label={`Akce u otázky ${label}`} busy={regenerate.busy ? 'Nahrazuji…' : null}>
        {onEdit ? <DropdownMenuItem onSelect={() => onEdit()}>Upravit</DropdownMenuItem> : null}
        {/* Bez nakonfigurovaného modelu se náhrada vůbec nenabídne — jinak by
            učitelka klikla a dozvěděla se to až z chyby. */}
        {regenerate.available ? (
          <DropdownMenuItem onSelect={() => void regenerate.run()}>Nahradit modelem</DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          variant="destructive"
          onSelect={(event) => {
            event.preventDefault()
            setConfirmOpen(true)
          }}
        >
          Smazat
        </DropdownMenuItem>
      </RowActions>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat otázku?</AlertDialogTitle>
            <AlertDialogDescription>
              Smaže se „{label}“. Pokud je otázka použitá v uloženém testu, zůstane tam její
              zmrazené znění, ale z banky zmizí. Akci nejde vrátit zpět.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              aria-busy={deleting || undefined}
              onClick={(event) => {
                event.preventDefault()
                void remove()
              }}
            >
              {deleting ? 'Mažu…' : 'Smazat'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
