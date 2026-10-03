'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, QuestionType } from '@testmaker/core/schema'
import { toast } from '@testmaker/ui'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

/**
 * Creates an easier or harder version of a question on the same material — a
 * menu item next to „Přegenerovat" on the question card.
 *
 * Unlike regeneration, the original stays unchanged; the version is an extra
 * card. Whether the action is offered at all (model configured, a type the AI
 * generates) is decided by `useRegenerateQuestion` in `RegenerateButton` —
 * the version sits in the same menu and does not show without it.
 */
export function useQuestionVariant(
  question: { id: string; type: QuestionType; difficulty: 1 | 2 | 3 },
  onCreated?: (question: Question) => void,
): {
  busyDirection: 'easier' | 'harder' | null
  /** Why a version cannot be created in this direction — `null` when it can. */
  disabledReason: (direction: 'easier' | 'harder') => string | null
  create: (direction: 'easier' | 'harder') => Promise<void>
} {
  const router = useRouter()
  const [busyDirection, setBusyDirection] = useState<'easier' | 'harder' | null>(null)

  function disabledReason(direction: 'easier' | 'harder'): string | null {
    const targetDifficulty = question.difficulty + (direction === 'easier' ? -1 : 1)
    if (targetDifficulty < 1 || targetDifficulty > 3) return t(direction === 'easier' ? 'generation:variant.limitEasier' : 'generation:variant.limitHarder')
    return null
  }

  async function create(direction: 'easier' | 'harder') {
    // A double click (or a click on the other direction while the first still
    // runs) would send two requests at once — until the first finishes, the
    // second is not started at all.
    if (busyDirection !== null) return
    if (disabledReason(direction)) return
    setBusyDirection(direction)
    try {
      const data = await requestJson<{ question: Question }>(
        '/api/questions/variant',
        jsonBody('POST', { id: question.id, direction }),
        t('generation:variant.failed'),
      )
      if (!data.question) {
        toast.error(`${t('generation:variant.failed')} ${t('common:errors.serverTrouble')}`)
        return
      }
      toast.success(
        direction === 'easier' ? t('generation:variant.createdEasier') : t('generation:variant.createdHarder'),
        { testId: `toast-question-variant-${direction}` },
      )
      onCreated?.(data.question)
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('generation:variant.failed')))
    } finally {
      setBusyDirection(null)
    }
  }

  return { busyDirection, disabledReason, create }
}
