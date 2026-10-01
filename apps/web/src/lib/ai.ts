import 'server-only'
import { AI_PROVIDERS, describeAiSetup } from '@testmaker/core/ai'

/**
 * AI status for the UI — without a model, generation is hidden instead of failing at runtime.
 * Shows the ladder's first model and `problems`: why something is missing from
 * the ladder (old variables, a typo, a missing key) so the owner can fix it.
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
