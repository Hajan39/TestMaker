'use client'

import type { Question, QuestionType } from '@testmaker/core/schema'
import { fetchOrOffline, readJson, responseError } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

export interface GenerateOptions {
  topicId: string
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
}

export type GenerateEvent =
  | { type: 'start' }
  | { type: 'progress'; done: number; total: number }
  /** A batch of questions is saved: how many there are in total and which just arrived. */
  | { type: 'saved'; created: number; questions: Question[] }
  | {
      type: 'done'
      created: number
      rejected: number
      failedCalls: number
      topicId: string
      sources: number
      /** Models used, in the order they were reached (the ladder after an exhausted quota). */
      models?: string[]
    }
  | { type: 'error'; message: string }

/** Calls generation and forwards the individual stream events. */
export async function generateQuestionsStream(
  options: GenerateOptions,
  onEvent: (event: GenerateEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchOrOffline(
    '/api/generate',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options),
      signal,
    },
    t('generation:generateClient.startFailed'),
  )

  if (!response.ok || !response.body) {
    // The server sends a readable explanation (missing key, generation already
    // running); a bare status code or an HTML error page tells the teacher nothing.
    throw responseError(response, await readJson(response), t('generation:generateClient.startFailed'))
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

export type TestVariantDirection = 'easier' | 'harder'

export type TestVariantEvent =
  /** `testId` is the copy's id — sent right away so the copy isn't orphaned if the stream ends early. */
  | { type: 'start'; total: number; testId: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; testId: string; replaced: number; generated: number; kept: number }
  | { type: 'error'; message: string }

/**
 * Creates an easier or harder version of a whole test and forwards progress
 * from the stream — same shape as `generateQuestionsStream`, just a different
 * route and a different `done` event.
 */
export async function createTestVariantStream(
  testId: string,
  direction: TestVariantDirection,
  onEvent: (event: TestVariantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchOrOffline(
    '/api/tests/variant',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ testId, direction }),
      signal,
    },
    t('generation:generateClient.testVariantFailed'),
  )

  if (!response.ok || !response.body) {
    // The server sends a readable explanation (no model, someone else's test);
    // a bare status code or an HTML error page tells the teacher nothing.
    throw responseError(response, await readJson(response), t('generation:generateClient.testVariantFailed'))
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
      if (line.trim()) onEvent(JSON.parse(line) as TestVariantEvent)
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as TestVariantEvent)
}

/** Works through the bulk generation queue by calling the runner while anything remains. */
export async function drainQueue(
  /**
   * Called after each runner request. `processed` says whether a topic was
   * really processed — the last request on an empty queue processes none, and
   * counting it as a topic meant one too many in every summary.
   */
  onStep: (info: { processed: boolean; created?: number; error?: string; remaining: number }) => void,
  shouldStop: () => boolean,
): Promise<void> {
  for (;;) {
    if (shouldStop()) return
    const failure = t('generation:generateClient.queueStopped')
    const response = await fetchOrOffline('/api/jobs/run', { method: 'POST' }, failure)
    const result = await readJson<{ processed: boolean; created?: number; remaining: number }>(response)
    // The server explains in plain words (missing key, expired session);
    // a bare "queue failed (503)" told the teacher nothing.
    if (!response.ok) throw responseError(response, result, failure)
    if (typeof result.processed !== 'boolean' || typeof result.remaining !== 'number') {
      throw responseError(response, {}, failure)
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
