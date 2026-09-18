'use client'

import type { Question, QuestionType } from '@testmaker/core/schema'

export interface GenerateOptions {
  topicId: string
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
}

export type GenerateEvent =
  | { type: 'start' }
  | { type: 'progress'; done: number; total: number }
  /** Dávka otázek je uložená: kolik jich už celkem je a které právě přibyly. */
  | { type: 'saved'; created: number; questions: Question[] }
  | {
      type: 'done'
      created: number
      rejected: number
      failedCalls: number
      topicId: string
      sources: number
      /** Použité modely v pořadí, jak na ně došlo (žebříček při vyčerpaném limitu). */
      models?: string[]
    }
  | { type: 'error'; message: string }

/** Volá generování a předává jednotlivé události ze streamu. */
export async function generateQuestionsStream(
  options: GenerateOptions,
  onEvent: (event: GenerateEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
    signal,
  })

  if (!response.ok || !response.body) {
    // Server posílá vysvětlení česky (chybějící klíč, už běžící generování);
    // holé číslo stavu učitelce nic neřekne.
    const detail = await response.text()
    const message = (() => {
      try {
        const parsed = JSON.parse(detail) as { error?: string }
        return parsed.error ?? detail
      } catch {
        return detail
      }
    })()
    throw new Error(message.slice(0, 300) || `Generování selhalo (${response.status})`)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as GenerateEvent)
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as GenerateEvent)
}

/** Zpracuje frontu hromadného generování voláním runneru, dokud něco zbývá. */
export async function drainQueue(
  /**
   * Volá se po každém dotazu na runner. `processed` říká, jestli se opravdu
   * zpracovalo téma — poslední dotaz na prázdnou frontu žádné nezpracuje a
   * počítat ho jako téma znamenalo o jedno víc v každém souhrnu.
   */
  onStep: (info: { processed: boolean; created?: number; error?: string; remaining: number }) => void,
  shouldStop: () => boolean,
): Promise<void> {
  for (;;) {
    if (shouldStop()) return
    const response = await fetch('/api/jobs/run', { method: 'POST' })
    if (!response.ok) throw new Error(`Fronta selhala (${response.status})`)
    const result = (await response.json()) as {
      processed: boolean
      created?: number
      error?: string
      remaining: number
    }
    onStep({
      processed: result.processed,
      created: result.created,
      error: result.error,
      remaining: result.remaining,
    })
    if (!result.processed && result.remaining === 0) return
  }
}
