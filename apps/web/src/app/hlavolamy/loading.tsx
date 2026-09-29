import { Delayed, LoadingCard, LoadingHeading, LoadingPaper, PageShell } from '@testmaker/ui'

/** Přechod na hlavolamy: kostra dílny vlevo a papíru s náhledem vpravo. */
export default function PuzzlesLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám hlavolamy…" className="space-y-5">
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
