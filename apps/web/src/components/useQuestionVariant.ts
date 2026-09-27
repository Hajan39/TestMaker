'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AI_QUESTION_TYPES, type Question, type QuestionType } from '@testmaker/core/schema'
import { toast } from '@testmaker/ui'

/** Zapamatovaná odpověď na „je model nakonfigurovaný?“ — ptáme se jednou za načtení stránky. */
let configuredCache: boolean | null = null

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
 * karta navíc. `available` kopíruje `useRegenerateQuestion`: bez modelu nebo
 * u typu, který AI negeneruje, se akce vůbec nenabízí.
 */
export function useQuestionVariant(
  question: { id: string; type: QuestionType; difficulty: 1 | 2 | 3 },
  onCreated?: (question: Question) => void,
): {
  available: boolean
  busyDirection: 'easier' | 'harder' | null
  /** Proč v tomhle směru verze nejde vytvořit — `null`, když jde. */
  disabledReason: (direction: 'easier' | 'harder') => string | null
  create: (direction: 'easier' | 'harder') => Promise<void>
} {
  const router = useRouter()
  const [configured, setConfigured] = useState<boolean | null>(configuredCache)
  const [busyDirection, setBusyDirection] = useState<'easier' | 'harder' | null>(null)

  useEffect(() => {
    if (configuredCache !== null) return
    let platne = true
    fetch('/api/questions/regenerate')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { configured?: boolean } | null) => {
        if (typeof data?.configured !== 'boolean') return
        configuredCache = data.configured
        if (platne) setConfigured(data.configured)
      })
      .catch(() => {})
    return () => {
      platne = false
    }
  }, [])

  const podporovanyTyp = (AI_QUESTION_TYPES as readonly string[]).includes(question.type)

  function disabledReason(direction: 'easier' | 'harder'): string | null {
    const cilova = question.difficulty + (direction === 'easier' ? -1 : 1)
    if (cilova < 1 || cilova > 3) return LIMIT_MESSAGE[direction]
    return null
  }

  async function create(direction: 'easier' | 'harder') {
    if (disabledReason(direction)) return
    setBusyDirection(direction)
    try {
      const response = await fetch('/api/questions/variant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: question.id, direction }),
      })
      const data = (await response.json()) as { question?: Question; error?: string }
      if (!response.ok || !data.question) {
        toast.error(data.error ?? 'Verzi se nepodařilo vytvořit')
        return
      }
      toast.success(direction === 'easier' ? 'Vznikla lehčí verze otázky.' : 'Vznikla těžší verze otázky.')
      onCreated?.(data.question)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Verzi se nepodařilo vytvořit')
    } finally {
      setBusyDirection(null)
    }
  }

  return { available: configured === true && podporovanyTyp, busyDirection, disabledReason, create }
}
