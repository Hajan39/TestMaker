import { topicSourceFile } from '@/lib/questionFile'
import { withScope } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

/** The topic's materials as text for Claude Code (`/otazky`). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(async (account) => {
    const { id } = await params
    const file = await topicSourceFile(account, id)
    if (!file) return Response.json({ error: t('library:questionFile.topicNotFound') }, { status: 404 })
    return new Response(file.text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="tema.txt"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      },
    })
  })
}
