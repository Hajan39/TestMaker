'use client'

import { useMutation } from '@tanstack/react-query'
import {
  BusyButton,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@testmaker/ui'
import { formatDateTime } from '@testmaker/core/dates'
import { t } from '@testmaker/core/i18n'
import { errorMessage, requestJson } from '@/lib/requestJson'

export interface ShareLinkResult {
  testId: string
  url: string
  expiresAt: string
}

/** Fresh print link for a saved test; rejects with a readable error. */
export async function requestShareLink(testId: string): Promise<ShareLinkResult> {
  const data = await requestJson<{ url: string; expiresAt: string }>(
    `/api/tests/${encodeURIComponent(testId)}/share`,
    { method: 'POST' },
    t('tests:share.createFailed'),
  )
  return { testId, url: data.url ?? '', expiresAt: data.expiresAt ?? '' }
}

/**
 * The print link with copy and "e-mail it to me". The link itself is issued
 * by the caller (`PrintMenu`, after saving) — the dialog only shows it.
 */
export function ShareLinkDialog({
  open,
  onOpenChange,
  link,
  pending,
  error,
  mail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  link: ShareLinkResult | null
  pending: boolean
  error: string | null
  /** Is e-mail configured on the server? Without it the button is replaced by a hint. */
  mail: boolean
}) {
  const emailMutation = useMutation({
    mutationFn: (testId: string) =>
      requestJson<{ email: string }>(
        `/api/tests/${encodeURIComponent(testId)}/share/email`,
        { method: 'POST' },
        t('tests:share.emailFailed'),
      ),
    onSuccess: (data) => toast.success(t('tests:share.emailSent', { email: data.email ?? '' }), { testId: 'toast-share-email' }),
    onError: (cause) => toast.error(errorMessage(cause, t('tests:share.emailFailed'))),
  })

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('tests:share.copied'), { testId: 'toast-share-copied' })
    } catch {
      toast.error(t('tests:share.copyFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>{t('tests:share.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('tests:share.dialogDescription')}</DialogDescription>
        </DialogHeader>
        {pending ? (
          <p className="text-sm text-fg-soft" role="status">
            {t('tests:share.creating')}
          </p>
        ) : error ? (
          <p className="text-sm text-danger" role="alert" data-testid="share-error">
            {error}
          </p>
        ) : link ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="share-link-url">{t('tests:share.linkLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="share-link-url"
                  readOnly
                  value={link.url}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button variant="outline" onClick={() => void copy(link.url)}>
                  {t('tests:share.copy')}
                </Button>
              </div>
            </div>
            <p className="text-sm text-fg-soft" data-testid="share-valid-until">
              {t('tests:share.validUntil', { date: formatDateTime(link.expiresAt) })}
            </p>
            <p className="text-sm text-fg-soft">{t('tests:share.pupilsOnly')}</p>
            {mail ? (
              <BusyButton
                variant="outline"
                busy={emailMutation.isPending}
                busyLabel={t('tests:share.sending')}
                onClick={() => emailMutation.mutate(link.testId)}
              >
                {t('tests:share.email')}
              </BusyButton>
            ) : (
              <p className="text-xs text-fg-muted" data-testid="share-email-hint">
                {t('tests:share.emailNotConfigured')}
              </p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
