'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AI_QUESTION_TYPES, type QuestionType } from '@testmaker/core/schema'
import { toast } from '@testmaker/ui'

/** Zapamatovaná odpověď na „je model nakonfigurovaný?“ — ptáme se jednou za načtení stránky. */
let configuredCache: boolean | null = null

/**
 * Náhrada jedné otázky modelem — bez ohledu na to, čím se spouští (tlačítkem
 * v kontrole, položkou nabídky v bance).
 *
 * `available` je `false`, dokud se neví, že je model nakonfigurovaný, a taky
 * u typů, které model neumí (třeba popis obrázku). Volající podle něj akci
 * vůbec nenabídne — jinak by učitelka klikla a dozvěděla se to až z chyby.
 * Původní otázka se zamítá až ve chvíli, kdy náhrada existuje; to hlídá server.
 */
export function useRegenerateQuestion(
  questionId: string,
  type: QuestionType,
  onDone?: () => void,
): { available: boolean; busy: boolean; run: () => Promise<void> } {
  const router = useRouter()
  const [configured, setConfigured] = useState<boolean | null>(configuredCache)
  const [busy, setBusy] = useState(false)

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

  const podporovanyTyp = (AI_QUESTION_TYPES as readonly string[]).includes(type)

  async function run() {
    setBusy(true)
    try {
      const response = await fetch('/api/questions/regenerate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: questionId }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        toast.error(data.error ?? 'Náhradu se nepodařilo vytvořit')
        return
      }
      toast.success('Otázka nahrazena novou.')
      onDone?.()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Náhradu se nepodařilo vytvořit')
    } finally {
      setBusy(false)
    }
  }

  return { available: configured === true && podporovanyTyp, busy, run }
}
