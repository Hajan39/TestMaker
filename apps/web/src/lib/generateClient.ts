'use client'

import type { QuestionType } from '@testmaker/core/schema'

export interface GenerateOptions {
  topicId: string
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
}

export type GenerateEvent =
  | { type: 'start' }
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'done'
      created: number
      rejected: number
      failedCalls: number
      topicId: string
      sources: number
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
    const detail = await response.text()
    throw new Error(`Generování selhalo (${response.status}): ${detail.slice(0, 200)}`)
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
  onStep: (info: { created?: number; error?: string; remaining: number }) => void,
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
    onStep({ created: result.created, error: result.error, remaining: result.remaining })
    if (!result.processed && result.remaining === 0) return
  }
}
