import 'server-only'
import { AI_PROVIDERS, describeAiSetup } from '@testmaker/core/ai'

/**
 * Stav AI pro UI — bez modelu se generování schová místo pádu za běhu.
 * Ukazuje první model žebříčku a `problems`: proč v žebříčku něco chybí
 * (staré proměnné, překlep, chybějící klíč), aby to majitel mohl opravit.
 */
export function aiStatus(): { configured: boolean; provider: string; model: string; problems: string[] } {
  const { ladder, problems } = describeAiSetup()
  const first = ladder[0]
  return {
    configured: Boolean(first),
    provider: first ? AI_PROVIDERS[first.provider].label : '',
    model: first?.model ?? '',
    problems,
  }
}
