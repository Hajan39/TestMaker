import type { LanguageModel } from 'ai'

export type AiProviderName = 'anthropic' | 'ollama'

export interface AiConfig {
  provider: AiProviderName
  model: string
}

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  anthropic: 'claude-opus-5',
  ollama: 'qwen3:14b',
}

/** Konfigurace z prostředí; provider je vyměnitelný bez zásahu do kódu. */
export function readAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const provider = (env.AI_PROVIDER ?? 'anthropic') as AiProviderName
  const name: AiProviderName = provider === 'ollama' ? 'ollama' : 'anthropic'
  return { provider: name, model: env.AI_MODEL || DEFAULT_MODELS[name] }
}

/** Je generování k dispozici? Anthropic potřebuje klíč, Ollama jen běžící server. */
export function isAiConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const { provider } = readAiConfig(env)
  return provider === 'ollama' ? true : Boolean(env.ANTHROPIC_API_KEY)
}

export async function getModel(config: AiConfig = readAiConfig()): Promise<LanguageModel> {
  if (config.provider === 'ollama') {
    const { createOllama } = await import('ollama-ai-provider-v2')
    const ollama = createOllama({ baseURL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/api' })
    return ollama(config.model)
  }
  const { createAnthropic } = await import('@ai-sdk/anthropic')
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return anthropic(config.model)
}
