import 'server-only'
import { isAiConfigured, readAiConfig } from '@testmaker/core/ai'

/** Stav AI pro UI — bez klíče se generování schová místo pádu za běhu. */
export function aiStatus(): { configured: boolean; provider: string; model: string } {
  const config = readAiConfig()
  return { configured: isAiConfigured(), provider: config.provider, model: config.model }
}
