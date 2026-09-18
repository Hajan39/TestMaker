import { z } from 'zod'
import { describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { PUZZLE_KINDS } from '@testmaker/core/schema'
import { suggestPuzzleWords } from '@/lib/puzzles'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({
  topicId: z.string().min(1),
  kind: z.enum(PUZZLE_KINDS),
  count: z.number().int().min(2).max(40).default(12),
  /** Slova, která už v hlavolamu jsou — model má dodat jiná. */
  avoid: z.array(z.string().min(1)).max(40).default([]),
})

/**
 * Slovní zásoba k tématu od modelu. Vrací jen dvojice slovo + nápověda;
 * mřížku skládá kód v prohlížeči i při tisku, model se v ní ztratí.
 */
export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return Response.json(
      {
        error:
          'Generování slov není nastavené — doplň ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN nebo GOOGLE_GENERATIVE_AI_API_KEY. Slova můžeš zatím napsat ručně.',
      },
      { status: 503 },
    )
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  try {
    const result = await suggestPuzzleWords(parsed.data.topicId, {
      kind: parsed.data.kind,
      count: parsed.data.count,
      avoid: parsed.data.avoid,
      signal: request.signal,
    })
    return Response.json(result)
  } catch (error) {
    // Hlášky poskytovatele jsou anglicky a technické; překládáme je.
    const { message } = describeAiError(error)
    return Response.json({ error: message }, { status: 502 })
  }
}
