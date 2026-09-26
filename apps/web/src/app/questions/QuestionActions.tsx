'use client'

import type { Question } from '@testmaker/core/schema'
import { DropdownMenuItem, toast } from '@testmaker/ui'
import { RowActions } from '@/components/RowActions'
import { useRegenerateQuestion } from '@/components/useRegenerateQuestion'
import { rejectQuestions, restoreStatuses } from '@/lib/questionStatusClient'

/**
 * Akce u jedné otázky v bance — v jediné nabídce pod třemi tečkami, stejně
 * jako u testů.
 *
 * Dřív byly v řádku dva textové odkazy vedle sebe a „Nahradit modelem"
 * vypadalo stejně neškodně jako „Upravit", přitom hotovou otázku přepíše.
 * V nabídce se na ně nedá kliknout omylem.
 *
 * Smazání je jen změna stavu na `rejected` a jde hned vrátit zpět (hláška
 * s akcí „Vrátit zpět"), proto tu není potvrzovací dialog — nic nevratného,
 * na co by se muselo ptát dopředu.
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
  const regenerate = useRegenerateQuestion(question.id, question.type, onChanged)

  async function remove() {
    try {
      const previous = await rejectQuestions([question])
      onChanged()
      toast.success('Otázka smazána', {
        duration: 10_000,
        action: {
          label: 'Vrátit zpět',
          onClick: () =>
            void restoreStatuses(previous)
              .then(() => {
                toast.success('Vráceno zpět')
                onChanged()
              })
              .catch((error) =>
                toast.error(error instanceof Error ? error.message : 'Vrácení se nepodařilo'),
              ),
        },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Otázku se nepodařilo smazat')
    }
  }

  return (
    <RowActions label={`Akce u otázky ${label}`} busy={regenerate.busy ? 'Nahrazuji…' : null}>
      {onEdit ? <DropdownMenuItem onSelect={() => onEdit()}>Upravit</DropdownMenuItem> : null}
      {/* Bez nakonfigurovaného modelu se náhrada vůbec nenabídne — jinak by
          učitelka klikla a dozvěděla se to až z chyby. */}
      {regenerate.available ? (
        <DropdownMenuItem onSelect={() => void regenerate.run()}>Nahradit modelem</DropdownMenuItem>
      ) : null}
      <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
        Smazat
      </DropdownMenuItem>
    </RowActions>
  )
}
