import { topicSourceFile } from '@/lib/questionFile'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/** Materiály tématu jako text pro Claude Code (`/otazky`). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return sRozsahem(async (ucet) => {
    const { id } = await params
    const file = await topicSourceFile(ucet, id)
    if (!file) return Response.json({ error: 'Téma se nenašlo' }, { status: 404 })
    return new Response(file.text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="tema.txt"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      },
    })
  })
}
