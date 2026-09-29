import { z } from 'zod'
import { puzzleContentSchema } from '@testmaker/core/schema'
import {
  describePuzzleIssues,
  insertPuzzle,
  loadPuzzleList,
  topicExists,
  TOPIC_NOT_FOUND_MESSAGE,
} from '@/lib/puzzles'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const createSchema = z.object({
  topicId: z.string().min(1).nullable().default(null),
  puzzle: puzzleContentSchema,
  /** Model, který dodal slova; prázdné u ručně psaného hlavolamu. */
  model: z.string().min(1).nullable().default(null),
})

/** Seznam hlavolamů; `?topicId=` zúží na jedno téma. */
export async function GET(request: Request) {
  return sRozsahem(async (ucet) => {
    const topicId = new URL(request.url).searchParams.get('topicId') ?? undefined
    return Response.json({ puzzles: await loadPuzzleList(ucet, { topicId }) })
  })
}

/** Uloží nový hlavolam. Mřížka se neukládá — skládá se ze slov a seedu. */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const parsed = createSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json(
          { error: describePuzzleIssues(parsed.error.issues), detail: parsed.error.issues },
          { status: 400 },
        )
      }
      // Cizí téma se tváří stejně jako neexistující; bez kontroly by uložení
      // spadlo na cizím klíči, nebo by se hlavolam navázal na téma jiné školy.
      if (parsed.data.topicId && !(await topicExists(ucet, parsed.data.topicId))) {
        return Response.json({ error: TOPIC_NOT_FOUND_MESSAGE }, { status: 404 })
      }

      const puzzle = await insertPuzzle(ucet, parsed.data.puzzle, {
        topicId: parsed.data.topicId,
        model: parsed.data.model,
      })
      return Response.json({ puzzle })
    },
    { zapis: true },
  )
}
