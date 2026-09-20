import type { LanguageModel } from 'ai'

/**
 * Služby, které mluví stejným rozhraním jako OpenAI („OpenAI-compatible").
 * Jeden klíč u jedné z nich otevře celou řadu modelů od různých výrobců, takže
 * žebříček nemusí znamenat další registraci u dalšího poskytovatele. Stejným
 * způsobem se osloví i lokální server (LM Studio, llama.cpp, vLLM) — proto je
 * v seznamu `custom`, kde se adresa napíše celá do prostředí.
 */
export type OpenAiCompatibleName = 'openrouter' | 'groq' | 'mistral' | 'deepinfra' | 'together' | 'custom'

export type AiProviderName = 'anthropic' | 'google' | 'ollama' | OpenAiCompatibleName

export interface AiConfig {
  provider: AiProviderName
  model: string
  /** Endpoint konkrétního workeru; staré konfigurace ho nemají. */
  baseURL?: string
}

export interface OpenAiCompatibleService {
  /** Jméno služby do hlášek a do hlaviček požadavku. */
  label: string
  /** Výchozí adresa rozhraní, ať ji majitel nemusí nikde opisovat. */
  baseURL: string
  /** Proměnná s klíčem, např. `OPENROUTER_API_KEY`. */
  apiKeyEnv: string
  /** Proměnná, kterou jde výchozí adresu přebít (vlastní proxy, lokální server). */
  baseUrlEnv: string
  /** Model, který se použije, když žádný nenapíšeš. */
  defaultModel: string
  /**
   * Potřebuje služba klíč? Cloudové ano; u `custom` (lokální server) ne —
   * tam stačí adresa.
   */
  requiresKey: boolean
  /**
   * Umí služba hlídat tvar odpovědi podle schématu (`response_format`
   * s JSON schématem)? Když ne, schéma se modelu jen popíše v promptu.
   * U vlastní adresy to nevíme, proto opatrné `false`.
   */
  supportsStructuredOutputs: boolean
}

/**
 * Známé služby s rozhraním OpenAI. Přidat další znamená dopsat sem řádek —
 * kód se kvůli tomu nemění a majitel nemusí opisovat adresu.
 */
export const OPENAI_COMPATIBLE_SERVICES: Record<OpenAiCompatibleName, OpenAiCompatibleService> = {
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrlEnv: 'OPENROUTER_BASE_URL',
    // Model zdarma s velkým kontextem. Nabídka modelů se sufixem `:free` se
    // u OpenRouteru mění, proto si ho ověř v seznamu modelů na jejich webu.
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    requiresKey: true,
    supportsStructuredOutputs: true,
  },
  groq: {
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    baseUrlEnv: 'GROQ_BASE_URL',
    defaultModel: 'llama-3.3-70b-versatile',
    requiresKey: true,
    supportsStructuredOutputs: true,
  },
  mistral: {
    label: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    baseUrlEnv: 'MISTRAL_BASE_URL',
    defaultModel: 'mistral-small-latest',
    requiresKey: true,
    supportsStructuredOutputs: true,
  },
  deepinfra: {
    label: 'DeepInfra',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
    baseUrlEnv: 'DEEPINFRA_BASE_URL',
    defaultModel: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
    requiresKey: true,
    supportsStructuredOutputs: true,
  },
  together: {
    label: 'Together',
    baseURL: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    baseUrlEnv: 'TOGETHER_BASE_URL',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    requiresKey: true,
    supportsStructuredOutputs: true,
  },
  custom: {
    label: 'Vlastní služba',
    // Bez výchozí adresy: `custom` je právě ten případ, kdy adresu známe jen
    // z prostředí (vlastní proxy nebo model běžící na jiném počítači doma).
    baseURL: '',
    apiKeyEnv: 'CUSTOM_API_KEY',
    baseUrlEnv: 'CUSTOM_BASE_URL',
    defaultModel: '',
    requiresKey: false,
    supportsStructuredOutputs: false,
  },
}

const COMPATIBLE_NAMES = Object.keys(OPENAI_COMPATIBLE_SERVICES) as OpenAiCompatibleName[]

export function isOpenAiCompatible(provider: AiProviderName): provider is OpenAiCompatibleName {
  return (COMPATIBLE_NAMES as string[]).includes(provider)
}

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  anthropic: 'claude-opus-5',
  // Alias na aktuální generaci "flash", který si Google sám posouvá dál —
  // konkrétní verze (2.5, 3.6…) rychle zestárnou. Ne `gemini-pro-latest`:
  // "pro" modely mají na bezplatném tarifu nulový limit a volání skončí
  // chybou o překročené kvótě. Pro vyšší kvalitu stačí nastavit AI_MODEL.
  google: 'gemini-flash-latest',
  ollama: 'qwen3:14b',
  openrouter: OPENAI_COMPATIBLE_SERVICES.openrouter.defaultModel,
  groq: OPENAI_COMPATIBLE_SERVICES.groq.defaultModel,
  mistral: OPENAI_COMPATIBLE_SERVICES.mistral.defaultModel,
  deepinfra: OPENAI_COMPATIBLE_SERVICES.deepinfra.defaultModel,
  together: OPENAI_COMPATIBLE_SERVICES.together.defaultModel,
  custom: OPENAI_COMPATIBLE_SERVICES.custom.defaultModel,
}

/**
 * Když `AI_PROVIDER` není nastavený, poskytovatel se pozná podle toho, který
 * klíč je v prostředí k dispozici. Pořadí je pevné a předvídatelné: Anthropic
 * má přednost (současné výchozí chování), pak Google a pak služby s rozhraním
 * OpenAI v pořadí, v jakém jsou vypsané výš. Ollama se takhle automaticky
 * nevybírá — nepotřebuje klíč, takže z jeho (ne)přítomnosti nejde poznat,
 * jestli lokální server vůbec běží; musí se zvolit výslovně přes
 * `AI_PROVIDER=ollama`. Bez jakéhokoli klíče zůstává výchozí Anthropic a
 * `isAiConfigured` níž nahlásí, že generování není k dispozici.
 */
function detectProvider(env: Record<string, string | undefined>): AiProviderName {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return 'anthropic'
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) return 'google'
  for (const name of COMPATIBLE_NAMES) {
    if (readOpenAiCompatibleSettings(name, env)) return name
  }
  return 'anthropic'
}

/** Konfigurace z prostředí; provider je vyměnitelný bez zásahu do kódu. */
export function readAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const requested = env.AI_PROVIDER
  const provider: AiProviderName = requested && isProviderName(requested) ? requested : detectProvider(env)
  return { provider, model: env.AI_MODEL || DEFAULT_MODELS[provider] }
}

/**
 * Adresa a klíč jedné služby s rozhraním OpenAI, složené z prostředí. `null`
 * znamená „takhle nastavená se použít nedá" — chybí klíč, nebo u vlastní
 * služby adresa. Je to jediné místo, které o tom rozhoduje: řídí se tím
 * `hasCredentials`, `detectProvider` i samotné sestavení modelu.
 */
export function readOpenAiCompatibleSettings(
  provider: OpenAiCompatibleName,
  env: Record<string, string | undefined> = process.env,
): { name: string; baseURL: string; apiKey?: string; supportsStructuredOutputs: boolean } | null {
  const service = OPENAI_COMPATIBLE_SERVICES[provider]
  const baseURL = env[service.baseUrlEnv]?.trim() || service.baseURL
  if (!baseURL) return null
  const apiKey = env[service.apiKeyEnv]?.trim() || undefined
  if (service.requiresKey && !apiKey) return null
  return { name: provider, baseURL, apiKey, supportsStructuredOutputs: service.supportsStructuredOutputs }
}

/**
 * Je generování k dispozici? Anthropic potřebuje klíč nebo OAuth token
 * (`ant auth login` → `ant auth print-credentials --access-token`), Google
 * klíč `GOOGLE_GENERATIVE_AI_API_KEY` (to je proměnná, kterou čte přímo
 * `@ai-sdk/google`), služby s rozhraním OpenAI svůj klíč (`OPENROUTER_API_KEY`
 * a spol.), Ollama jen běžící server.
 */
export function isAiConfigured(env: Record<string, string | undefined> = process.env): boolean {
  // Se žebříčkem (`AI_MODELS`) stačí, aby se dalo přihlásit aspoň k jednomu
  // modelu ze seznamu; bez něj je v žebříčku jediná položka a chování je stejné
  // jako dřív.
  return readAiLadder(env).some((config) => hasCredentials(config.provider, env))
}

export interface ModelOptions {
  /** Prostředí, ze kterého se berou klíče a adresy; v testech podvržené. */
  env?: Record<string, string | undefined>
  /**
   * Podvržený `fetch` pro testy. Žádný test nesmí volat skutečnou službu —
   * tudy se volání zachytí dřív, než opustí počítač.
   */
  fetch?: typeof globalThis.fetch
}

export async function getModel(config: AiConfig = readAiConfig(), options: ModelOptions = {}): Promise<LanguageModel> {
  const env = options.env ?? process.env
  const fetch = options.fetch
  if (isOpenAiCompatible(config.provider)) {
    const settings = readOpenAiCompatibleSettings(config.provider, env)
    if (!settings) {
      const service = OPENAI_COMPATIBLE_SERVICES[config.provider]
      throw new Error(
        `Služba ${service.label} není nastavená: chybí ${service.requiresKey ? service.apiKeyEnv : service.baseUrlEnv} v .env.local.`,
      )
    }
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    const provider = createOpenAICompatible({
      name: settings.name,
      baseURL: settings.baseURL,
      apiKey: settings.apiKey,
      supportsStructuredOutputs: settings.supportsStructuredOutputs,
      ...(fetch ? { fetch } : {}),
    })
    return provider(config.model)
  }
  if (config.provider === 'ollama') {
    const { createOllama } = await import('ollama-ai-provider-v2')
    const ollama = createOllama({
      baseURL: config.baseURL || env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/api',
      ...(fetch ? { fetch } : {}),
    })
    return ollama(config.model)
  }
  if (config.provider === 'google') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const google = createGoogleGenerativeAI({
      apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
      ...(fetch ? { fetch } : {}),
    })
    return google(config.model)
  }
  const { createAnthropic } = await import('@ai-sdk/anthropic')
  // Buď klíč (x-api-key), nebo OAuth token (Authorization: Bearer). Obojí naráz
  // provider odmítne, takže token má přednost.
  const authToken = env.ANTHROPIC_AUTH_TOKEN
  const anthropic = authToken
    ? createAnthropic({ authToken, headers: { 'anthropic-beta': 'oauth-2025-04-20' }, ...(fetch ? { fetch } : {}) })
    : createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(fetch ? { fetch } : {}) })
  return anthropic(config.model)
}

/** Má prostředí, čím se u tohohle poskytovatele přihlásit? */
function hasCredentials(provider: AiProviderName, env: Record<string, string | undefined>): boolean {
  if (isOpenAiCompatible(provider)) return readOpenAiCompatibleSettings(provider, env) !== null
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
  return (
    value === 'anthropic' ||
    value === 'google' ||
    value === 'ollama' ||
    (COMPATIBLE_NAMES as string[]).includes(value)
  )
}

/**
 * Jedna položka žebříčku: `poskytovatel:model` (`google:gemini-flash-latest`,
 * `openrouter:nvidia/nemotron-3-super-120b-a12b:free`), nebo jen `model` — ten
 * pak patří poskytovateli podle `AI_PROVIDER`, případně podle klíčů
 * v prostředí. Dvojtečka se dělí jen na prvním výskytu a jen když před ní stojí
 * známý poskytovatel: model Ollamy se jmenuje `qwen3:14b` a názvy modelů
 * zdarma u OpenRouteru končí na `:free` — ani jedno se rozdělit nesmí.
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
  const fallback = readAiConfig(env)
  if (fallback.provider === 'ollama') return [fallback]

  const raw = env.AI_MODELS?.trim()
  if (!raw) return [fallback]

  const parsed: AiConfig[] = []
  for (const item of raw.split(',')) {
    const config = parseLadderItem(item, fallback.provider)
    if (!config) continue
    if (config.provider === 'ollama') continue
    if (parsed.some((other) => other.provider === config.provider && other.model === config.model)) continue
    parsed.push(config)
  }
  if (parsed.length === 0) return [fallback]

  const usable = parsed.filter((config) => hasCredentials(config.provider, env))
  return usable.length > 0 ? usable : parsed
}

/** Popis modelu do logu a do hlášky: `google:gemini-flash-latest`. */
export function describeAiConfig(config: AiConfig): string {
  return config.baseURL ? `${config.provider}@${config.baseURL}:${config.model}` : `${config.provider}:${config.model}`
}

/**
 * Načte lokální Ollama workery ve tvaru `endpoint|model`, oddělené čárkami.
 * Neplatné položky se vynechají; pokud nezbyde žádná, použije se staré
 * `OLLAMA_BASE_URL` + `AI_MODEL` nastavení.
 */
export function readOllamaWorkers(env: Record<string, string | undefined> = process.env): AiConfig[] {
  if (env.AI_PROVIDER?.trim() !== 'ollama') return []
  const raw = env.OLLAMA_WORKERS?.trim()
  if (!raw) return []

  const workers: AiConfig[] = []
  for (const item of raw.split(',')) {
    const separator = item.indexOf('|')
    if (separator <= 0) continue
    const baseURL = item.slice(0, separator).trim()
    const model = item.slice(separator + 1).trim()
    if (!baseURL || !model) continue
    if (workers.some((worker) => worker.baseURL === baseURL && worker.model === model)) continue
    workers.push({ provider: 'ollama', model, baseURL })
  }
  return workers
}
