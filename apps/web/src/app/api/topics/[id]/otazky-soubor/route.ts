import { QuestionFileError } from '@testmaker/core/ai'
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
        // Jen chyba obsahu souboru (nevalidní JSON, chybějící seznam otázek)
        // smí učitelce popsat, co má opravit — cokoli jiného (třeba výpadek
        // databáze) není chyba souboru a musí propadnout jako 500, ne se
        // tvářit jako snadno opravitelný problém se souborem.
        if (error instanceof QuestionFileError) {
          return Response.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    },
    { zapis: true },
  )
}
