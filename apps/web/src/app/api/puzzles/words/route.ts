import { z } from 'zod'
import { t } from '@testmaker/core/i18n'
import { aiNotConfiguredMessage, describeAiError, isAiConfigured, isNearDuplicate } from '@testmaker/core/ai'
import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  PUZZLE_KINDS,
  PUZZLE_PHRASE_MAX,
  type PuzzleEntry,
} from '@testmaker/core/schema'
import { loadPuzzleWordDraft, savePuzzleWordDraft, suggestPuzzleWords } from '@/lib/puzzles'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({
  topicId: z.string().min(1),
  kind: z.enum(PUZZLE_KINDS),
  count: z.number().int().min(2).max(40).default(12),
  /** Words already in the puzzle — the model is to supply different ones. */
  avoid: z.array(z.string().min(1)).max(40).default([]),
  /**
   * Cryptogram phrase. Without it the model does not know which letters the
   * words must contain. Optional for older clients; an empty phrase = none.
   */
  phrase: z.string().max(PUZZLE_PHRASE_MAX).optional(),
  /** Word search grid size; the longest word is checked against it. Clamped to the limits. */
  cols: z.number().int().optional(),
  rows: z.number().int().optional(),
})

/** The most words a topic draft keeps — a puzzle cannot hold more. */
const MAX_DRAFT_ENTRIES = 40

function clampGrid(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, value))
}

/**
 * The topic's word draft after generating more: existing words stay and new
 * ones are appended (without forms of the same word). The draft used to be
 * overwritten by the new batch alone, and on returning to the topic the words
 * from the first round were gone.
 */
function mergeDraft(existing: PuzzleEntry[], added: PuzzleEntry[]): PuzzleEntry[] {
  const merged = [...existing]
  for (const entry of added) {
    const same = merged.findIndex((item) => isNearDuplicate(item.word, entry.word))
    if (same === -1) merged.push(entry)
    else merged[same] = entry
  }
  // Over the limit the oldest words are dropped, the new batch stays whole.
  return merged.slice(-MAX_DRAFT_ENTRIES)
}

/**
 * Topic vocabulary from the model. Returns only word + clue pairs; the grid is
 * built by code in the browser and when printing, the model would get lost in it.
 */
export async function GET(request: Request) {
  return withScope(async (account) => {
    const url = new URL(request.url)
    const topicId = url.searchParams.get('topicId')
    const kind = url.searchParams.get('kind')
    if (!topicId || (kind !== 'wordsearch' && kind !== 'cryptogram')) {
      return Response.json({ error: t('puzzles:errors.missingParams') }, { status: 400 })
    }
    return Response.json({ entries: await loadPuzzleWordDraft(account, topicId, kind) })
  })
}

export async function POST(request: Request) {
  return withScope(async (account) => {
  if (!isAiConfigured()) {
    return Response.json(
      { error: t('puzzles:errors.aiOffManual', { message: aiNotConfiguredMessage() }) },
      { status: 503 },
    )
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: t('puzzles:errors.invalidData'), detail: parsed.error.issues }, { status: 400 })
  }

  try {
    const { topicId, kind } = parsed.data
    const cols = clampGrid(parsed.data.cols)
    const rows = clampGrid(parsed.data.rows)
    const result = await suggestPuzzleWords(account, topicId, {
      kind,
      count: parsed.data.count,
      avoid: parsed.data.avoid,
      phrase: kind === 'cryptogram' ? parsed.data.phrase?.trim() || undefined : undefined,
      grid: kind === 'wordsearch' && cols && rows ? { cols, rows } : undefined,
      signal: request.signal,
    })
    if (result.entries.length === 0) {
      // No usable word is not a success: the UI should show a warning with advice,
      // not "0 words added". The draft is not overwritten.
      return Response.json(
        { ...result, error: result.warning ?? t('puzzles:errors.noUsableWord') },
        { status: 422 },
      )
    }
    const draft = mergeDraft(await loadPuzzleWordDraft(account, topicId, kind), result.entries)
    await savePuzzleWordDraft(account, topicId, kind, draft, result.models.at(-1))
    return Response.json(result)
  } catch (error) {
    // Provider messages are English and technical; we translate them. The raw
    // text stays in the server log for the owner.
    console.error('Failed to extract puzzle words:', error)
    const { message } = describeAiError(error)
    return Response.json({ error: message }, { status: 502 })
  }
  }, { write: true })
}
