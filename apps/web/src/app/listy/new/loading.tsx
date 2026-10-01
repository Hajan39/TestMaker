import { t } from '@testmaker/core/i18n'
import { Delayed, LoadingCard, LoadingHeading, PageShell } from '@testmaker/ui'

/** A new worksheet is a form, not a table of worksheets — the skeleton has its shape. */
export default function NewWorksheetLoading() {
  return (
    <PageShell>
      <Delayed label={t('worksheets:loading.form')} className="space-y-5">
        <LoadingHeading />
        <LoadingCard lines={6} />
      </Delayed>
    </PageShell>
  )
}
