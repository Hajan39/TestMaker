import { generateObject, NoObjectGeneratedError, type LanguageModel } from 'ai'
import type { z } from 'zod'
import { describeAiError } from './errors'
import { describeAiConfig, getModel, type AiConfig } from './provider'
import { AI_SETTINGS } from './settings'

export const NO_MODEL_MESSAGE = 'Žádný model není nastavený. Doplň do .env.local klíč a případně AI_MODELS.'

/** Vytáhne z chyby surovou odpověď modelu, pokud ji nese (model odpověděl, jen ne ve tvaru). */
export function rawTextOf(error: unknown): string | null {
  if (!NoObjectGeneratedError.isInstance(error)) return null
  const text = (error as { text?: unknown }).text
  return typeof text === 'string' ? text : null
}

/** Jeden pokus o volání jednoho modelu — i ten, kterému došel limit. */
export interface AiCallEvent {
  /** `poskytovatel:model` */
  model: string
  outcome: 'ok' | 'limit' | 'bad_shape' | 'error'
  inputTokens: number | null
  outputTokens: number | null
  durationMs: number
}

/** Posluchač pokusů o volání. Core o úloze ani o databázi neví; zapisuje až web. */
export type AiCallListener = (event: AiCallEvent) => void

/** Kudy funkce volání předá žebříčku spotřebu tokenů. */
export interface CallMeter {
  usage(input: number | null | undefined, output: number | null | undefined): void
}

export interface LadderRun {
  /** Modely, které v běhu opravdu odpověděly (`poskytovatel:model`), v pořadí použití. */
  used: string[]
  /** Zavolá `fn` s prvním modelem, kterému ještě nedošel limit. */
  call<T>(fn: (config: AiConfig, meter: CallMeter) => Promise<T>, options?: { nextOnBadShape?: boolean }): Promise<{ value: T; model: string }>
}

/**
 * Jeden běh nad žebříčkem modelů. Model, kterému došel limit nebo je
 * přetížený, se do konce běhu přeskakuje — jinak by na tutéž chybu čekala
 * každá další dávka. Chyba, na které nic nezmění ani jiný model (chybný klíč),
 * letí rovnou nahoru. Odpověď ve špatném tvaru znamená, že model funguje:
 * volající ji zachrání sám (otázky), nebo si řekne o další model (hlavolamy).
 *
 * `onCall` dostane každý pokus o volání (i model, kterému došel limit).
 * Přerušení se neměří a výjimka z posluchače generování nikdy neshodí.
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
      console.error('Záznam o volání modelu se nepodařilo předat:', error)
    }
  }

  return {
    used,
    async call(fn, options = {}) {
      let lastError: unknown = new Error(NO_MODEL_MESSAGE)
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

/** Volání modelu, které vrací objekt podle schématu. Model se sestaví jednou na běh. */
export type ObjectCall<T> = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
  /** Kam zapsat spotřebu tokenů; poskytovatel bez `usage` zapíše `null`. */
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
