import type { LanguageModel } from 'ai'

export type AiProviderName = 'anthropic' | 'google' | 'ollama'

export interface AiConfig {
  provider: AiProviderName
  model: string
}

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  anthropic: 'claude-opus-5',
  // Alias na aktuální generaci "flash", který si Google sám posouvá dál —
  // konkrétní verze (2.5, 3.6…) rychle zestárnou. Ne `gemini-pro-latest`:
  // "pro" modely mají na bezplatném tarifu nulový limit a volání skončí
  // chybou o překročené kvótě. Pro vyšší kvalitu stačí nastavit AI_MODEL.
  google: 'gemini-flash-latest',
  ollama: 'qwen3:14b',
}

/**
 * Když `AI_PROVIDER` není nastavený, poskytovatel se pozná podle toho, který
 * klíč je v prostředí k dispozici. Pořadí je pevné a předvídatelné: Anthropic
 * má přednost (současné výchozí chování), pak Google. Ollama se takhle
 * automaticky nevybírá — nepotřebuje klíč, takže z jeho (ne)přítomnosti nejde
 * poznat, jestli lokální server vůbec běží; musí se zvolit výslovně přes
 * `AI_PROVIDER=ollama`. Bez jakéhokoli klíče zůstává výchozí Anthropic a
 * `isAiConfigured` níž nahlásí, že generování není k dispozici.
 */
function detectProvider(env: Record<string, string | undefined>): AiProviderName {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return 'anthropic'
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) return 'google'
  return 'anthropic'
}

/** Konfigurace z prostředí; provider je vyměnitelný bez zásahu do kódu. */
export function readAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const requested = env.AI_PROVIDER
  const provider: AiProviderName =
    requested === 'anthropic' || requested === 'google' || requested === 'ollama'
      ? requested
      : detectProvider(env)
  return { provider, model: env.AI_MODEL || DEFAULT_MODELS[provider] }
}

/**
 * Je generování k dispozici? Anthropic potřebuje klíč nebo OAuth token
 * (`ant auth login` → `ant auth print-credentials --access-token`), Google
 * klíč `GOOGLE_GENERATIVE_AI_API_KEY` (to je proměnná, kterou čte přímo
 * `@ai-sdk/google`), Ollama jen běžící server.
 */
export function isAiConfigured(env: Record<string, string | undefined> = process.env): boolean {
  // Se žebříčkem (`AI_MODELS`) stačí, aby se dalo přihlásit aspoň k jednomu
  // modelu ze seznamu; bez něj je v žebříčku jediná položka a chování je stejné
  // jako dřív.
  return readAiLadder(env).some((config) => hasCredentials(config.provider, env))
}

export async function getModel(config: AiConfig = readAiConfig()): Promise<LanguageModel> {
  if (config.provider === 'ollama') {
    const { createOllama } = await import('ollama-ai-provider-v2')
    const ollama = createOllama({ baseURL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/api' })
    return ollama(config.model)
  }
  if (config.provider === 'google') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
    return google(config.model)
  }
  const { createAnthropic } = await import('@ai-sdk/anthropic')
  // Buď klíč (x-api-key), nebo OAuth token (Authorization: Bearer). Obojí naráz
  // provider odmítne, takže token má přednost.
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN
  const anthropic = authToken
    ? createAnthropic({ authToken, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    : createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return anthropic(config.model)
}

/** Má prostředí, čím se u tohohle poskytovatele přihlásit? */
function hasCredentials(provider: AiProviderName, env: Record<string, string | undefined>): boolean {
  switch (provider) {
    case 'ollama':
      return true
    case 'google':
      return Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY)
    case 'anthropic':
      return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)
  }
}

function isProviderName(value: string): value is AiProviderName {
  return value === 'anthropic' || value === 'google' || value === 'ollama'
}

/**
 * Jedna položka žebříčku: `poskytovatel:model` (`google:gemini-flash-latest`),
 * nebo jen `model` — ten pak patří poskytovateli podle `AI_PROVIDER`, případně
 * podle klíčů v prostředí. Dvojtečka se dělí jen na prvním výskytu a jen když
 * před ní stojí známý poskytovatel: model Ollamy se jmenuje `qwen3:14b` a ten
 * se rozdělit nesmí.
 */
function parseLadderItem(item: string, fallback: AiProviderName): AiConfig | null {
  const trimmed = item.trim()
  if (!trimmed) return null
  const separator = trimmed.indexOf(':')
  if (separator > 0) {
    const prefix = trimmed.slice(0, separator).trim()
    const rest = trimmed.slice(separator + 1).trim()
    if (isProviderName(prefix) && rest) return { provider: prefix, model: rest }
  }
  return { provider: fallback, model: trimmed }
}

/**
 * Žebříček modelů z `AI_MODELS` — seznam oddělený čárkami, ve kterém se
 * pokračuje, když předchozímu modelu dojde limit nebo je přetížený.
 *
 * Bez `AI_MODELS` vrací jediný model podle `AI_PROVIDER`/`AI_MODEL`, tedy
 * přesně to, co dělala aplikace dřív. Do žebříčku se nikdy nedostane
 * poskytovatel, kterého tam majitel sám nenapsal — placený model se nesmí
 * zapnout sám od sebe.
 *
 * Položky pro poskytovatele bez klíče se vynechávají: jinak by žebříček
 * skončil hned na první z nich („klíč neplatí" není chyba na opakování).
 * Kdyby po vynechání nezbylo nic, vrátí se seznam tak, jak ho majitel napsal,
 * ať se chyba o chybějícím klíči objeví normálně.
 */
export function readAiLadder(env: Record<string, string | undefined> = process.env): AiConfig[] {
  const raw = env.AI_MODELS?.trim()
  if (!raw) return [readAiConfig(env)]

  const fallback = readAiConfig(env).provider
  const parsed: AiConfig[] = []
  for (const item of raw.split(',')) {
    const config = parseLadderItem(item, fallback)
    if (!config) continue
    if (parsed.some((other) => other.provider === config.provider && other.model === config.model)) continue
    parsed.push(config)
  }
  if (parsed.length === 0) return [readAiConfig(env)]

  const usable = parsed.filter((config) => hasCredentials(config.provider, env))
  return usable.length > 0 ? usable : parsed
}

/** Popis modelu do logu a do hlášky: `google:gemini-flash-latest`. */
export function describeAiConfig(config: AiConfig): string {
  return `${config.provider}:${config.model}`
}
