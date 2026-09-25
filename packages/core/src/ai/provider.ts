import type { LanguageModel } from 'ai'
import { AI_SETTINGS } from './settings'

/**
 * Poskytovatelé, se kterými aplikace mluví. Každý potřebuje jen svůj klíč;
 * který model a v jakém pořadí, říká jediná proměnná `AI_MODELS`.
 *
 * Anthropic jen s API klíčem z Console: přihlášení předplatným (Claude Max)
 * Anthropic mimo Claude Code odmítá. Otázky přes předplatné se dělají
 * v Claude Code příkazem `/otazky` a nahrávají se do tématu jako soubor.
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
 * Položka žebříčku `poskytovatel:model`. Dělí se jen na první dvojtečce —
 * modely zdarma u OpenRouteru končí na `:free`. Bez známé předpony `null`.
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
 * Hláška, když generování není nastavené — všude stejná (API i rozhraní),
 * ať majitel dostane jeden návod, ne čtyři různé.
 */
export const AI_NOT_CONFIGURED_MESSAGE =
  'Generování není nastavené. Do .env.local přidej do AI_MODELS položku poskytovatel:model a k ní klíč ' +
  '(GOOGLE_GENERATIVE_AI_API_KEY, OPENROUTER_API_KEY nebo ANTHROPIC_API_KEY).'

/**
 * Proměnné z dřívějšího nastavení (Ollama, `AI_PROVIDER`…). Aplikace je už
 * nečte; kdo je v `.env.local` má, přišel by o generování bez vysvětlení.
 */
const LEGACY_AI_VARIABLES = [
  'AI_PROVIDER',
  'AI_MODEL',
  'ANTHROPIC_AUTH_TOKEN',
  'OLLAMA_WORKERS',
  'OLLAMA_BASE_URL',
  'OLLAMA_CONCURRENCY',
] as const

/** Poskytovatelé v pořadí pro hlášky: napřed ti se zdarma. */
const PROVIDER_LIST = (['google', 'openrouter', 'anthropic'] as const satisfies readonly AiProviderName[]).join(', ')

/**
 * Žebříček modelů i to, proč v něm něco chybí. `problems` jsou české věty
 * pro majitele (co v `.env.local` opravit): staré proměnné, položka bez
 * známého poskytovatele, položka bez klíče. Žebříček sám je týž jako
 * z `readAiLadder`.
 */
export function describeAiSetup(env: Env = process.env): { ladder: AiConfig[]; problems: string[] } {
  const problems: string[] = []
  for (const name of LEGACY_AI_VARIABLES) {
    if (env[name]?.trim()) {
      problems.push(`Proměnná ${name} už se nepoužívá — model nastav v AI_MODELS (viz .env.example).`)
    }
  }

  const raw = env.AI_MODELS?.trim()
  const items = (raw ? raw.split(',') : [...AI_SETTINGS.defaultModels]).map((item) => item.trim()).filter(Boolean)
  const ladder: AiConfig[] = []
  for (const item of items) {
    const config = parseModel(item)
    if (!config) {
      problems.push(`Položka „${item}" v AI_MODELS nemá známého poskytovatele (${PROVIDER_LIST}).`)
      continue
    }
    if (!apiKeyOf(config.provider, env)) {
      problems.push(`K položce „${item}" chybí klíč ${AI_PROVIDERS[config.provider].keyEnv}.`)
      continue
    }
    if (ladder.some((other) => other.provider === config.provider && other.model === config.model)) continue
    ladder.push(config)
  }
  // Jen oddělovače (`AI_MODELS=,`): nic se nevynechalo, a přesto nic není.
  if (ladder.length === 0 && problems.length === 0) {
    problems.push('V AI_MODELS není žádná položka poskytovatel:model.')
  }
  return { ladder, problems }
}

/**
 * Žebříček modelů: `AI_MODELS`, bez něj `AI_SETTINGS.defaultModels`. Když
 * modelu dojde limit, pokračuje se dalším (viz `startLadder`). Položky bez
 * klíče nebo s překlepem se vynechávají (proč, říká `describeAiSetup`);
 * placený model se tak nikdy nezapne sám — jen tím, že ho majitel do
 * žebříčku napíše a dá k němu klíč.
 */
export function readAiLadder(env: Env = process.env): AiConfig[] {
  return describeAiSetup(env).ladder
}

/** Je generování k dispozici? Bez něj ho rozhraní skryje a vysvětlí proč. */
export function isAiConfigured(env: Env = process.env): boolean {
  return readAiLadder(env).length > 0
}

export interface ModelOptions {
  /** Prostředí, ze kterého se berou klíče; v testech podvržené. */
  env?: Env
  /** Podvržený `fetch` pro testy — žádný test nesmí volat skutečnou službu. */
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

/** Popis modelu do logu a hlášky: `google:gemini-flash-latest`. */
export function describeAiConfig(config: AiConfig): string {
  return `${config.provider}:${config.model}`
}
