import { t } from '@testmaker/core/i18n'
import { issueShareLink, publicOrigin, shareSecret } from '@/lib/share'
import { withScope, writeAudit } from '@/lib/user'

/** A fresh 7-day print link for the author's own test: `{ url, expiresAt }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(
    async (account) => {
      const { id } = await params
      const secret = shareSecret()
      if (!secret) return Response.json({ error: t('tests:share.secretMissing') }, { status: 503 })

      const link = await issueShareLink(account, id, publicOrigin(request), secret)
      if (!link) return Response.json({ error: t('tests:api.testNotFound') }, { status: 404 })

      await writeAudit({
        schoolId: account.schoolId,
        userId: account.userId,
        action: 'odkaz-na-tisk',
        entity: 'test',
        entityId: id,
        detail: { platiDo: link.expiresAt },
      })
      return Response.json({ url: link.url, expiresAt: link.expiresAt })
    },
    { write: true },
  )
}
