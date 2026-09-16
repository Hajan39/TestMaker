'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AI_QUESTION_TYPES, type QuestionType } from '@testmaker/core/schema'
import { BusyButton, toast } from '@testmaker/ui'

/** Zapamatovaná odpověď na „je model nakonfigurovaný?“ — ptáme se jednou za načtení stránky. */
let configuredCache: boolean | null = null

/**
 * Nechá model vyrobit náhradu jedné otázky.
 *
 * Bez nakonfigurovaného modelu se tlačítko vůbec nenabídne (jinak by učitelka
 * klikla a dozvěděla se to až z chyby). Původní otázka se zamítá až ve chvíli,
 * kdy náhrada existuje — to hlídá server.
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

  // Typy, které model generovat neumí (třeba popis obrázku), nahradit nejdou.
  const podporovanyTyp = (AI_QUESTION_TYPES as readonly string[]).includes(type)
  if (configured !== true || !podporovanyTyp) return null

  async function regenerate() {
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
      toast.success('Otázka nahrazena novou od modelu. Původní je zamítnutá.')
      onDone?.()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Náhradu se nepodařilo vytvořit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BusyButton size="sm" variant="ghost" busy={busy} busyLabel="Nahrazuji…" onClick={() => void regenerate()}>
      Nahradit modelem
    </BusyButton>
  )
}
