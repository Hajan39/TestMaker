import 'server-only'
import { AI_PROVIDERS, readAiLadder } from '@testmaker/core/ai'

/** Stav AI pro UI — bez modelu se generování schová místo pádu za běhu. Ukazuje první model žebříčku. */
export function aiStatus(): { configured: boolean; provider: string; model: string } {
  const first = readAiLadder()[0]
  return {
    configured: Boolean(first),
    provider: first ? AI_PROVIDERS[first.provider].label : '',
    model: first?.model ?? '',
  }
}
