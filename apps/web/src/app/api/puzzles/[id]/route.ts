import { z } from 'zod'
import { t } from '@testmaker/core/i18n'
import { puzzleContentSchema } from '@testmaker/core/schema'
import { deletePuzzle, describePuzzleIssues, loadPuzzle, topicExists, updatePuzzle } from '@/lib/puzzles'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'

const updateSchema = z.object({
  topicId: z.string().min(1).nullable().optional(),
  puzzle: puzzleContentSchema,
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(async (account) => {
    const { id } = await params
    // A colleague's puzzle looks non-existent — why should the response reveal
    // that someone at the school has it?
    const puzzle = await loadPuzzle(account, id)
    if (!puzzle) return Response.json({ error: t('puzzles:errors.notFound') }, { status: 404 })
    return Response.json({ puzzle })
  })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(
    async (account) => {
      const { id } = await params
      const parsed = updateSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json(
          { error: describePuzzleIssues(parsed.error.issues), detail: parsed.error.issues },
          { status: 400 },
        )
      }
      if (parsed.data.topicId && !(await topicExists(account, parsed.data.topicId))) {
        return Response.json({ error: t('puzzles:errors.topicNotFound') }, { status: 404 })
      }

      const puzzle = await updatePuzzle(account, id, parsed.data.puzzle, { topicId: parsed.data.topicId })
      if (!puzzle) return Response.json({ error: t('puzzles:errors.notFound') }, { status: 404 })
      return Response.json({ puzzle })
    },
    { write: true },
  )
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(
    async (account) => {
      const { id } = await params
      const deleted = await deletePuzzle(account, id)
      if (!deleted) return Response.json({ error: t('puzzles:errors.notFound') }, { status: 404 })
      return Response.json({ ok: true })
    },
    { write: true },
  )
}
