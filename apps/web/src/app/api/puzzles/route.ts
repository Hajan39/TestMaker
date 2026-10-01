import { z } from 'zod'
import { t } from '@testmaker/core/i18n'
import { puzzleContentSchema } from '@testmaker/core/schema'
import { describePuzzleIssues, insertPuzzle, loadPuzzleList, topicExists } from '@/lib/puzzles'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'

const createSchema = z.object({
  topicId: z.string().min(1).nullable().default(null),
  puzzle: puzzleContentSchema,
  /** The model that supplied the words; empty for a hand-written puzzle. */
  model: z.string().min(1).nullable().default(null),
})

/** List of puzzles; `?topicId=` narrows it to one topic. */
export async function GET(request: Request) {
  return withScope(async (account) => {
    const topicId = new URL(request.url).searchParams.get('topicId') ?? undefined
    return Response.json({ puzzles: await loadPuzzleList(account, { topicId }) })
  })
}

/** Saves a new puzzle. The grid is not stored — it is built from the words and the seed. */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
      const parsed = createSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json(
          { error: describePuzzleIssues(parsed.error.issues), detail: parsed.error.issues },
          { status: 400 },
        )
      }
      // A foreign topic looks the same as a missing one; without the check the
      // save would fail on a foreign key, or the puzzle would link to another school's topic.
      if (parsed.data.topicId && !(await topicExists(account, parsed.data.topicId))) {
        return Response.json({ error: t('puzzles:errors.topicNotFound') }, { status: 404 })
      }

      const puzzle = await insertPuzzle(account, parsed.data.puzzle, {
        topicId: parsed.data.topicId,
        model: parsed.data.model,
      })
      return Response.json({ puzzle })
    },
    { write: true },
  )
}
