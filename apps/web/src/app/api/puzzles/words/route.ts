import { z } from 'zod'
import { AI_NOT_CONFIGURED_MESSAGE, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { PUZZLE_KINDS } from '@testmaker/core/schema'
import { loadPuzzleWordDraft, savePuzzleWordDraft, suggestPuzzleWords } from '@/lib/puzzles'
import { sRozsahem } from '@/lib/uzivatel'

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
export async function GET(request: Request) {
  return sRozsahem(async (ucet) => {
    const url = new URL(request.url)
    const topicId = url.searchParams.get('topicId')
    const kind = url.searchParams.get('kind')
    if (!topicId || (kind !== 'wordsearch' && kind !== 'cryptogram')) {
      return Response.json({ error: 'Chybí téma nebo druh hlavolamu.' }, { status: 400 })
    }
    return Response.json({ entries: await loadPuzzleWordDraft(ucet, topicId, kind) })
  })
}

export async function POST(request: Request) {
  return sRozsahem(async (ucet) => {
  if (!isAiConfigured()) {
    return Response.json(
      { error: `${AI_NOT_CONFIGURED_MESSAGE} Slova můžeš zatím napsat ručně.` },
      { status: 503 },
    )
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  try {
    const result = await suggestPuzzleWords(ucet, parsed.data.topicId, {
      kind: parsed.data.kind,
      count: parsed.data.count,
      avoid: parsed.data.avoid,
      signal: request.signal,
    })
    await savePuzzleWordDraft(ucet, parsed.data.topicId, parsed.data.kind, result.entries, result.models.at(-1))
    return Response.json(result)
  } catch (error) {
    // Hlášky poskytovatele jsou anglicky a technické; překládáme je.
    const { message } = describeAiError(error)
    return Response.json({ error: message }, { status: 502 })
  }
  }, { zapis: true })
}
