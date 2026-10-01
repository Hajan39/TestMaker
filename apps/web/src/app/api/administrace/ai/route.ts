import { t } from '@testmaker/core/i18n'
import { periodFrom, aiUsageOverview } from '@/lib/aiUsage'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'

/**
 * AI usage overview for a period (`?dni=7|30|90`, default 30). Anyone who is not
 * an administrator gets 404 — the response must not reveal that anything is here.
 */
export async function GET(request: Request) {
  return withScope(async (account) => {
    const overview = await aiUsageOverview(account, periodFrom(new URL(request.url).searchParams.get('dni')))
    if (!overview) return Response.json({ error: t('admin:errors.notFound') }, { status: 404 })
    return Response.json(overview)
  })
}
