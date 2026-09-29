import { z } from 'zod'
import { AI_NOT_CONFIGURED_MESSAGE, describeAiError, isAiConfigured, isNearDuplicate } from '@testmaker/core/ai'
import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  PUZZLE_KINDS,
  PUZZLE_PHRASE_MAX,
  type PuzzleEntry,
} from '@testmaker/core/schema'
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
  /**
   * Věta tajenky. Bez ní model neví, která písmena mají slova obsahovat.
   * Nepovinná kvůli starším klientům; prázdná věta = žádná.
   */
  phrase: z.string().max(PUZZLE_PHRASE_MAX).optional(),
  /** Velikost mřížky osmisměrky; podle ní se hlídá nejdelší slovo. Mimo meze se ořízne. */
  cols: z.number().int().optional(),
  rows: z.number().int().optional(),
})

/** Nejvíc slov, které si koncept k tématu pamatuje — víc jich hlavolam nepojme. */
const MAX_DRAFT_ENTRIES = 40

function clampGrid(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, value))
}

/**
 * Koncept slov k tématu po dogenerování: dosavadní slova zůstanou a nová se
 * připíšou (bez tvarů téhož slova). Dřív se koncept přepsal jen novou dávkou
 * a po návratu k tématu byla slova z prvního kola pryč.
 */
function mergeDraft(existing: PuzzleEntry[], added: PuzzleEntry[]): PuzzleEntry[] {
  const merged = [...existing]
  for (const entry of added) {
    const same = merged.findIndex((item) => isNearDuplicate(item.word, entry.word))
    if (same === -1) merged.push(entry)
    else merged[same] = entry
  }
  // Přes limit se zahazují nejstarší slova, nová dávka zůstane celá.
  return merged.slice(-MAX_DRAFT_ENTRIES)
}

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
    const { topicId, kind } = parsed.data
    const cols = clampGrid(parsed.data.cols)
    const rows = clampGrid(parsed.data.rows)
    const result = await suggestPuzzleWords(ucet, topicId, {
      kind,
      count: parsed.data.count,
      avoid: parsed.data.avoid,
      phrase: kind === 'cryptogram' ? parsed.data.phrase?.trim() || undefined : undefined,
      grid: kind === 'wordsearch' && cols && rows ? { cols, rows } : undefined,
      signal: request.signal,
    })
    if (result.entries.length === 0) {
      // Žádné použitelné slovo není úspěch: rozhraní má ukázat varování s radou,
      // ne „Přibylo 0 slov". Koncept se nepřepisuje.
      return Response.json(
        { ...result, error: result.warning ?? 'Model nevrátil žádné použitelné slovo. Zkus to znovu.' },
        { status: 422 },
      )
    }
    const draft = mergeDraft(await loadPuzzleWordDraft(ucet, topicId, kind), result.entries)
    await savePuzzleWordDraft(ucet, topicId, kind, draft, result.models.at(-1))
    return Response.json(result)
  } catch (error) {
    // Hlášky poskytovatele jsou anglicky a technické; překládáme je. Surové
    // znění zůstane v logu serveru pro majitele.
    console.error('Slova do hlavolamu se nepodařilo vytáhnout:', error)
    const { message } = describeAiError(error)
    return Response.json({ error: message }, { status: 502 })
  }
  }, { zapis: true })
}
