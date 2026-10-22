'use client'

import { useState } from 'react'
import { BusyButton, downloadPdf, printPdf, toast } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/** Print and download of the pupil version, per variant when the test has two. */
export function SharedPrintActions({ token, variants }: { token: string; variants: number }) {
  const [busy, setBusy] = useState<string | null>(null)
  const list: ('A' | 'B')[] = variants === 2 ? ['A', 'B'] : ['A']

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key)
    try {
      await action()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      {list.map((variant) => {
        const href = `/api/tisk/${encodeURIComponent(token)}?varianta=${variant}`
        const suffix = variants === 2 ? t('tests:print.variantSuffix', { variant }) : ''
        return (
          <div key={variant} className="flex flex-wrap gap-2">
            <BusyButton
              busy={busy === `print-${variant}`}
              busyLabel={t('tests:share.page.preparing')}
              disabled={busy !== null}
              onClick={() => void run(`print-${variant}`, () => printPdf(href))}
            >
              {t('tests:share.page.print', { suffix })}
            </BusyButton>
            <BusyButton
              variant="outline"
              busy={busy === `pdf-${variant}`}
              busyLabel={t('tests:share.page.preparing')}
              disabled={busy !== null}
              onClick={() => void run(`pdf-${variant}`, () => downloadPdf(href))}
            >
              {t('tests:share.page.download', { suffix })}
            </BusyButton>
          </div>
        )
      })}
    </div>
  )
}
