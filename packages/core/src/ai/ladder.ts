import { generateObject, NoObjectGeneratedError, type LanguageModel } from 'ai'
import type { z } from 'zod'
import { t } from '../i18n'
import { describeAiError } from './errors'
import { describeAiConfig, getModel, type AiConfig } from './provider'
import { AI_SETTINGS } from './settings'

/** Error when the ladder has no model to call. */
export function noModelMessage(): string {
  return t('ai:setup.noModel')
}

/** Extracts the raw model answer from the error, if it carries one (the model answered, just not in shape). */
export function rawTextOf(error: unknown): string | null {
  if (!NoObjectGeneratedError.isInstance(error)) return null
  const text = (error as { text?: unknown }).text
  return typeof text === 'string' ? text : null
}

/** One attempt to call one model — including one that ran out of quota. */
export interface AiCallEvent {
  /** `provider:model` */
  model: string
  outcome: 'ok' | 'limit' | 'bad_shape' | 'error'
  inputTokens: number | null
  outputTokens: number | null
  durationMs: number
}

/** Listener for call attempts. Core knows nothing about jobs or the database; the web records them. */
export type AiCallListener = (event: AiCallEvent) => void

/** How the call function reports token usage to the ladder. */
export interface CallMeter {
  usage(input: number | null | undefined, output: number | null | undefined): void
}

export interface LadderRun {
  /** Models that actually answered during the run (`provider:model`), in order of use. */
  used: string[]
  /** Calls `fn` with the first model that has not run out of quota yet. */
  call<T>(fn: (config: AiConfig, meter: CallMeter) => Promise<T>, options?: { nextOnBadShape?: boolean }): Promise<{ value: T; model: string }>
}

/**
 * One run over the model ladder. A model that ran out of quota or is
 * overloaded is skipped until the end of the run — otherwise every further
 * batch would wait for the same error. An error that no other model would
 * change either (wrong key) is thrown right away. An answer in the wrong
 * shape means the model works: the caller either salvages it (questions) or
 * asks for the next model (puzzles).
 *
 * `onCall` receives every call attempt (including a model out of quota).
 * Aborts are not measured, and an exception from the listener never breaks
 * generation.
 */
export function startLadder(models: AiConfig[], signal?: AbortSignal, onCall?: AiCallListener): LadderRun {
  const exhausted = new Set<string>()
  const used: string[] = []
  const markUsed = (key: string) => {
    if (!used.includes(key)) used.push(key)
  }
  const report = (
    model: string,
    outcome: AiCallEvent['outcome'],
    started: number,
    tokens: { input: number | null; output: number | null },
  ) => {
    if (!onCall) return
    try {
      onCall({ model, outcome, inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - started })
    } catch (error) {
      console.error('Failed to report a model call record:', error)
    }
  }

  return {
    used,
    async call(fn, options = {}) {
      let lastError: unknown = new Error(noModelMessage())
      for (const config of models) {
        const key = describeAiConfig(config)
        if (exhausted.has(key)) continue
        const started = Date.now()
        const tokens: { input: number | null; output: number | null } = { input: null, output: null }
        const meter: CallMeter = {
          usage(input, output) {
            tokens.input = input ?? null
            tokens.output = output ?? null
          },
        }
        try {
          const value = await fn(config, meter)
          report(key, 'ok', started, tokens)
          markUsed(key)
          return { value, model: key }
        } catch (error) {
          if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw error
          const badShape = rawTextOf(error) !== null
          const retryable = describeAiError(error).retryable
          report(key, badShape ? 'bad_shape' : retryable ? 'limit' : 'error', started, tokens)
          if (badShape && !options.nextOnBadShape) {
            markUsed(key)
            throw error
          }
          if (!retryable) throw error
          exhausted.add(key)
          lastError = error
        }
      }
      throw lastError
    },
  }
}

/** Model call returning an object per the schema. The model is built once per run. */
export type ObjectCall<T> = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
  /** Where to record token usage; a provider without `usage` records `null`. */
  meter?: CallMeter
}) => Promise<T>

export function objectCall<S extends z.ZodType>(schema: S): ObjectCall<z.infer<S>> {
  const models = new Map<string, LanguageModel>()
  return async ({ config, system, prompt, signal, meter }) => {
    const key = describeAiConfig(config)
    let model = models.get(key)
    if (!model) {
      model = await getModel(config)
      models.set(key, model)
    }
    const { object, usage } = await generateObject({
      model,
      schema: schema as z.ZodType<z.infer<S>>,
      system,
      prompt,
      abortSignal: signal,
      maxRetries: AI_SETTINGS.maxRetries,
    })
    meter?.usage(usage?.inputTokens, usage?.outputTokens)
    return object as z.infer<S>
  }
}
