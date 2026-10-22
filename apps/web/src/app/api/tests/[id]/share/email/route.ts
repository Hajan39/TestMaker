import { formatDateTime } from '@testmaker/core/dates'
import { t } from '@testmaker/core/i18n'
import { MailError, allowMail, escapeHtml, mailSettings, sendMail } from '@/lib/mail'
import { issueShareLink, publicOrigin, shareSecret } from '@/lib/share'
import { withScope, writeAudit } from '@/lib/user'

/**
 * Sends a fresh print link to the signed-in author's own address. The
 * recipient is always the account's e-mail — never one from the request, so
 * the button cannot be used to mail links (or spam) anywhere else.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(
    async (account) => {
      const { id } = await params
      const settings = mailSettings()
      if (!settings) return Response.json({ error: t('tests:share.emailNotConfigured') }, { status: 503 })
      const secret = shareSecret()
      if (!secret) return Response.json({ error: t('tests:share.secretMissing') }, { status: 503 })

      const link = await issueShareLink(account, id, publicOrigin(request), secret)
      if (!link) return Response.json({ error: t('tests:api.testNotFound') }, { status: 404 })
      if (!allowMail(account.userId)) return Response.json({ error: t('tests:share.emailLimit') }, { status: 429 })

      const date = formatDateTime(link.expiresAt)
      const lines = [
        t('tests:share.mail.intro', { title: link.title }),
        link.url,
        t('tests:share.mail.validUntil', { date }),
        t('tests:share.mail.pupilsOnly'),
        t('tests:share.mail.footer'),
      ]
      const href = escapeHtml(link.url)
      const html = [
        `<p>${escapeHtml(lines[0]!)}</p>`,
        `<p><a href="${href}">${href}</a></p>`,
        `<p>${escapeHtml(lines[2]!)}<br>${escapeHtml(lines[3]!)}</p>`,
        `<p style="color:#666">${escapeHtml(lines[4]!)}</p>`,
      ].join('\n')

      try {
        await sendMail(settings, {
          to: { email: account.email, name: account.name },
          subject: t('tests:share.mail.subject', { title: link.title }),
          html,
          text: lines.join('\n\n'),
        })
      } catch (error) {
        const detail = error instanceof MailError ? error.detail : String(error)
        console.error('Print link e-mail failed:', detail)
        await writeAudit({
          schoolId: account.schoolId,
          userId: account.userId,
          action: 'odkaz-e-mailem-chyba',
          entity: 'test',
          entityId: id,
          detail: { technicky: detail },
          severity: 'chyba',
        })
        return Response.json({ error: t('tests:share.emailFailed') }, { status: 502 })
      }

      await writeAudit({
        schoolId: account.schoolId,
        userId: account.userId,
        action: 'odkaz-e-mailem',
        entity: 'test',
        entityId: id,
        detail: { platiDo: link.expiresAt },
      })
      return Response.json({ email: account.email, expiresAt: link.expiresAt })
    },
    { write: true },
  )
}
