'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, QuestionType } from '@testmaker/core/schema'
import { toast } from '@testmaker/ui'
import { errorMessage, jsonBody, requestJson, SERVER_TROUBLE } from '@/lib/requestJson'

/**
 * Hlášky na hranici obtížnosti — musí souhlasit s `variantDifficultyLimitMessage`
 * na serveru (`apps/web/src/lib/generation.ts`). Ten soubor je `server-only`,
 * proto se stejný text drží tady zvlášť místo importu.
 */
const LIMIT_MESSAGE: Record<'easier' | 'harder', string> = {
  easier: 'Otázka je už nejlehčí.',
  harder: 'Otázka je už nejtěžší.',
}

/**
 * Vytvoření lehčí nebo těžší verze otázky na stejnou látku — tlačítko v menu
 * u „Přegenerovat" na kartě otázky.
 *
 * Na rozdíl od přegenerování originál zůstává beze změny; verze je nová
 * karta navíc. Jestli se akce vůbec nabídne (model nastavený, typ, který AI
 * generuje), rozhoduje `useRegenerateQuestion` v `RegenerateButton` — verze
 * sedí v témže menu a bez něj se neukáže.
 */
export function useQuestionVariant(
  question: { id: string; type: QuestionType; difficulty: 1 | 2 | 3 },
  onCreated?: (question: Question) => void,
): {
  busyDirection: 'easier' | 'harder' | null
  /** Proč v tomhle směru verze nejde vytvořit — `null`, když jde. */
  disabledReason: (direction: 'easier' | 'harder') => string | null
  create: (direction: 'easier' | 'harder') => Promise<void>
} {
  const router = useRouter()
  const [busyDirection, setBusyDirection] = useState<'easier' | 'harder' | null>(null)

  function disabledReason(direction: 'easier' | 'harder'): string | null {
    const cilova = question.difficulty + (direction === 'easier' ? -1 : 1)
    if (cilova < 1 || cilova > 3) return LIMIT_MESSAGE[direction]
    return null
  }

  async function create(direction: 'easier' | 'harder') {
    // Dvojí kliknutí (nebo kliknutí na druhý směr, dokud první ještě běží)
    // by poslalo dva požadavky najednou — než první doběhne, druhý se
    // vůbec nezakládá.
    if (busyDirection !== null) return
    if (disabledReason(direction)) return
    setBusyDirection(direction)
    try {
      const data = await requestJson<{ question: Question }>(
        '/api/questions/variant',
        jsonBody('POST', { id: question.id, direction }),
        'Verzi se nepodařilo vytvořit.',
      )
      if (!data.question) {
        toast.error(`Verzi se nepodařilo vytvořit. ${SERVER_TROUBLE}`)
        return
      }
      toast.success(direction === 'easier' ? 'Vznikla lehčí verze otázky.' : 'Vznikla těžší verze otázky.')
      onCreated?.(data.question)
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, 'Verzi se nepodařilo vytvořit.'))
    } finally {
      setBusyDirection(null)
    }
  }

  return { busyDirection, disabledReason, create }
}
