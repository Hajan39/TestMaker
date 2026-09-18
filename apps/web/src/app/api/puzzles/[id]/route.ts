import { z } from 'zod'
import { puzzleContentSchema } from '@testmaker/core/schema'
import { deletePuzzle, loadPuzzle, updatePuzzle } from '@/lib/puzzles'

export const runtime = 'nodejs'

const updateSchema = z.object({
  topicId: z.string().min(1).nullable().optional(),
  puzzle: puzzleContentSchema,
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const puzzle = await loadPuzzle(id)
  if (!puzzle) return Response.json({ error: 'Hlavolam se nenašel' }, { status: 404 })
  return Response.json({ puzzle })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = updateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data hlavolamu', detail: parsed.error.issues }, { status: 400 })
  }

  const puzzle = await updatePuzzle(id, parsed.data.puzzle, { topicId: parsed.data.topicId })
  if (!puzzle) return Response.json({ error: 'Hlavolam se nenašel' }, { status: 404 })
  return Response.json({ puzzle })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const deleted = await deletePuzzle(id)
  if (!deleted) return Response.json({ error: 'Hlavolam se nenašel' }, { status: 404 })
  return Response.json({ ok: true })
}
