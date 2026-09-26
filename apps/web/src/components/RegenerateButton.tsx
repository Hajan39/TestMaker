'use client'

import type { QuestionType } from '@testmaker/core/schema'
import { BusyButton } from '@testmaker/ui'
import { useRegenerateQuestion } from '@/components/useRegenerateQuestion'

/**
 * Nechá model vyrobit náhradu jedné otázky — samostatné tlačítko do kontroly
 * otázek, kde je na akce místo v celé ploše.
 *
 * Bez nakonfigurovaného modelu se tlačítko vůbec nenabídne (jinak by učitelka
 * klikla a dozvěděla se to až z chyby). Rozhodování o tom i samotná náhrada
 * jsou v `useRegenerateQuestion`, aby se tatáž akce dala nabídnout i jako
 * položka nabídky u řádku banky.
 */
export function RegenerateButton({
  questionId,
  type,
  onDone,
}: {
  questionId: string
  type: QuestionType
  /** Zavolá se po úspěšné náhradě; bez něj se jen obnoví stránka. */
  onDone?: () => void
}) {
  const { available, busy, run } = useRegenerateQuestion(questionId, type, onDone)
  if (!available) return null

  return (
    <BusyButton size="sm" variant="ghost" busy={busy} busyLabel="Přegeneruji…" onClick={() => void run()}>
      Přegenerovat
    </BusyButton>
  )
}
