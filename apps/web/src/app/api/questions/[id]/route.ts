import { t } from '@testmaker/core/i18n'
import { loadQuestion } from '@/lib/questions'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'

/**
 * The current version of one bank question. The test builder uses it to
 * reload a question that was edited after being added to the test — the
 * frozen snapshot itself is retaken on the server when the test is saved.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(async (account) => {
    const { id } = await params
    const question = await loadQuestion(account, id)
    if (!question) return Response.json({ error: t('tests:page.reloadFailed') }, { status: 404 })
    return Response.json({ question })
  })
}
