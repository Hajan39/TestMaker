import { z } from 'zod'
import { puzzleContentSchema } from '@testmaker/core/schema'
import { deletePuzzle, loadPuzzle, updatePuzzle } from '@/lib/puzzles'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const updateSchema = z.object({
  topicId: z.string().min(1).nullable().optional(),
  puzzle: puzzleContentSchema,
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return sRozsahem(async (ucet) => {
    const { id } = await params
    // Cizí hlavolam se tváří jako neexistující — proč by mělo být z odpovědi
    // poznat, že ho někdo ve škole má?
    const puzzle = await loadPuzzle(ucet, id)
    if (!puzzle) return Response.json({ error: 'Hlavolam se nenašel' }, { status: 404 })
    return Response.json({ puzzle })
  })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return sRozsahem(
    async (ucet) => {
      const { id } = await params
      const parsed = updateSchema.safeParse(await request.json())
      if (!parsed.success) {
        return Response.json(
          { error: 'Neplatná data hlavolamu', detail: parsed.error.issues },
          { status: 400 },
        )
      }

      const puzzle = await updatePuzzle(ucet, id, parsed.data.puzzle, { topicId: parsed.data.topicId })
      if (!puzzle) return Response.json({ error: 'Hlavolam se nenašel' }, { status: 404 })
      return Response.json({ puzzle })
    },
    { zapis: true },
  )
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return sRozsahem(
    async (ucet) => {
      const { id } = await params
      const deleted = await deletePuzzle(ucet, id)
      if (!deleted) return Response.json({ error: 'Hlavolam se nenašel' }, { status: 404 })
      return Response.json({ ok: true })
    },
    { zapis: true },
  )
}
