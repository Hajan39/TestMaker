import type { LanguageModel } from 'ai'
import { t } from '../i18n'
import { AI_SETTINGS } from './settings'

/**
 * Providers the app talks to. Each needs only its own key; which model and in
 * what order is set by the single variable `AI_MODELS`.
 *
 * Anthropic only with an API key from the Console: Anthropic rejects
 * subscription sign-in (Claude Max) outside Claude Code. Questions via the
 * subscription are made in Claude Code with the `/otazky` command and
 * uploaded to the topic as a file.
 */
export type AiProviderName = 'google' | 'anthropic' | 'openrouter'

export interface AiConfig {
  provider: AiProviderName
  model: string
}

export const AI_PROVIDERS: Record<AiProviderName, { label: string; keyEnv: string }> = {
  google: { label: 'Google Gemini', keyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  anthropic: { label: 'Anthropic', keyEnv: 'ANTHROPIC_API_KEY' },
  openrouter: { label: 'OpenRouter', keyEnv: 'OPENROUTER_API_KEY' },
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

type Env = Record<string, string | undefined>

function isProviderName(value: string): value is AiProviderName {
  return Object.hasOwn(AI_PROVIDERS, value)
}

/**
 * Ladder item `provider:model`. Split only at the first colon — free models
 * on OpenRouter end with `:free`. `null` without a known prefix.
 */
export function parseModel(item: string): AiConfig | null {
  const trimmed = item.trim()
  const separator = trimmed.indexOf(':')
  if (separator <= 0) return null
  const provider = trimmed.slice(0, separator).trim()
  const model = trimmed.slice(separator + 1).trim()
  return isProviderName(provider) && model ? { provider, model } : null
}

function apiKeyOf(provider: AiProviderName, env: Env): string | undefined {
  return env[AI_PROVIDERS[provider].keyEnv]?.trim() || undefined
}

/**
 * Message when generation is not configured — the same everywhere (API and
 * UI), so the owner gets one set of instructions, not four different ones.
 */
export function aiNotConfiguredMessage(): string {
  return t('ai:setup.notConfigured')
}

/**
 * Variables from the earlier setup (Ollama, `AI_PROVIDER`…). The app no
 * longer reads them; whoever has them in `.env.local` would lose generation
 * without explanation.
 */
const LEGACY_AI_VARIABLES = [
  'AI_PROVIDER',
  'AI_MODEL',
  'ANTHROPIC_AUTH_TOKEN',
  'OLLAMA_WORKERS',
  'OLLAMA_BASE_URL',
  'OLLAMA_CONCURRENCY',
] as const

/** Providers in the order used in messages: free ones first. */
const PROVIDER_LIST = (['google', 'openrouter', 'anthropic'] as const satisfies readonly AiProviderName[]).join(', ')

/** Ladder items as written: `AI_MODELS`, or the default models without it. */
function ladderItems(env: Env): string[] {
  const raw = env.AI_MODELS?.trim()
  return (raw ? raw.split(',') : [...AI_SETTINGS.defaultModels]).map((item) => item.trim()).filter(Boolean)
}

/**
 * Ladder for the administration overview: in `AI_MODELS` order, including
 * models without a key (those are skipped during generation). Items without a
 * known provider and repeats are left out.
 */
export function listAiModels(env: Env = process.env): { model: string; hasKey: boolean }[] {
  const seen = new Set<string>()
  return ladderItems(env).flatMap((item) => {
    const config = parseModel(item)
    if (!config) return []
    const model = describeAiConfig(config)
    if (seen.has(model)) return []
    seen.add(model)
    return [{ model, hasKey: Boolean(apiKeyOf(config.provider, env)) }]
  })
}

/**
 * The model ladder and why something is missing from it. `problems` are
 * sentences for the owner (what to fix in `.env.local`): legacy variables,
 * an item without a known provider, an item without a key. The ladder itself
 * is the same as from `readAiLadder`.
 */
export function describeAiSetup(env: Env = process.env): { ladder: AiConfig[]; problems: string[] } {
  const problems: string[] = []
  for (const name of LEGACY_AI_VARIABLES) {
    if (env[name]?.trim()) {
      problems.push(t('ai:setup.legacyVariable', { name }))
    }
  }

  const ladder: AiConfig[] = []
  for (const item of ladderItems(env)) {
    const config = parseModel(item)
    if (!config) {
      problems.push(t('ai:setup.unknownProvider', { item, providers: PROVIDER_LIST }))
      continue
    }
    if (!apiKeyOf(config.provider, env)) {
      problems.push(t('ai:setup.missingKey', { item, keyEnv: AI_PROVIDERS[config.provider].keyEnv }))
      continue
    }
    if (ladder.some((other) => other.provider === config.provider && other.model === config.model)) continue
    ladder.push(config)
  }
  // Only separators (`AI_MODELS=,`): nothing was skipped, yet there is nothing.
  if (ladder.length === 0 && problems.length === 0) {
    problems.push(t('ai:setup.emptyLadder'))
  }
  return { ladder, problems }
}

/**
 * Model ladder: `AI_MODELS`, or `AI_SETTINGS.defaultModels` without it. When
 * a model runs out of quota, the next one continues (see `startLadder`).
 * Items without a key or with a typo are skipped (`describeAiSetup` says
 * why); a paid model is therefore never enabled on its own — only by the owner
 * writing it into the ladder and giving it a key.
 */
export function readAiLadder(env: Env = process.env): AiConfig[] {
  return describeAiSetup(env).ladder
}

/** Is generation available? Without it the UI hides it and explains why. */
export function isAiConfigured(env: Env = process.env): boolean {
  return readAiLadder(env).length > 0
}

export interface ModelOptions {
  /** Environment the keys are read from; faked in tests. */
  env?: Env
  /** Fake `fetch` for tests — no test may call the real service. */
  fetch?: typeof globalThis.fetch
}

export async function getModel(config: AiConfig, options: ModelOptions = {}): Promise<LanguageModel> {
  const env = options.env ?? process.env
  const apiKey = apiKeyOf(config.provider, env)
  const fetch = options.fetch ? { fetch: options.fetch } : {}
  switch (config.provider) {
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({ apiKey, ...fetch })(config.model)
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey, ...fetch })(config.model)
    }
    case 'openrouter': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
        supportsStructuredOutputs: true,
        ...fetch,
      })(config.model)
    }
  }
}

/** Model description for logs and messages: `google:gemini-flash-latest`. */
export function describeAiConfig(config: AiConfig): string {
  return `${config.provider}:${config.model}`
}
