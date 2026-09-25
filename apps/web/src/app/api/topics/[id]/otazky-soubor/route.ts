import { importQuestionFile } from '@/lib/questionFile'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/** Nahraje soubor s otázkami z Claude Code do tématu. Tělo požadavku je obsah souboru. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return sRozsahem(
    async (ucet) => {
      const { id } = await params
      try {
        const result = await importQuestionFile(ucet, id, await request.text())
        if (!result) return Response.json({ error: 'Téma se nenašlo' }, { status: 404 })
        return Response.json(result)
      } catch (error) {
        // readQuestionFile hází jen srozumitelné české hlášky o obsahu souboru.
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
      }
    },
    { zapis: true },
  )
}
