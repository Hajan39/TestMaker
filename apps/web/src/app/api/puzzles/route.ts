import { z } from 'zod'
import { puzzleContentSchema } from '@testmaker/core/schema'
import { insertPuzzle, loadPuzzleList } from '@/lib/puzzles'

export const runtime = 'nodejs'

const createSchema = z.object({
  topicId: z.string().min(1).nullable().default(null),
  puzzle: puzzleContentSchema,
  /** Model, který dodal slova; prázdné u ručně psaného hlavolamu. */
  model: z.string().min(1).nullable().default(null),
})

/** Seznam hlavolamů; `?topicId=` zúží na jedno téma. */
export async function GET(request: Request) {
  const topicId = new URL(request.url).searchParams.get('topicId') ?? undefined
  return Response.json({ puzzles: await loadPuzzleList(topicId) })
}

/** Uloží nový hlavolam. Mřížka se neukládá — skládá se ze slov a seedu. */
export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data hlavolamu', detail: parsed.error.issues }, { status: 400 })
  }

  const puzzle = await insertPuzzle(parsed.data.puzzle, {
    topicId: parsed.data.topicId,
    model: parsed.data.model,
  })
  return Response.json({ puzzle })
}
