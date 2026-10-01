import { t } from '@testmaker/core/i18n'
import { Delayed, LoadingCard, LoadingHeading, LoadingPaper, PageShell } from '@testmaker/ui'

/** Transition to puzzles: workshop skeleton on the left, paper preview on the right. */
export default function PuzzlesLoading() {
  return (
    <PageShell>
      <Delayed label={t('puzzles:page.loading')} className="space-y-5">
        <LoadingHeading />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <LoadingCard lines={5} />
            <LoadingCard lines={4} />
          </div>
          <LoadingPaper />
        </div>
      </Delayed>
    </PageShell>
  )
}
