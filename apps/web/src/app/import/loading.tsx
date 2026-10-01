import { Delayed, LoadingCard, LoadingHeading, PageShell } from '@testmaker/ui'

/** Přechod na import: jednostránkový formulář nad knihovnou. */
export default function ImportLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám import…" className="space-y-5">
        <LoadingHeading />
        <LoadingCard lines={4} />
      </Delayed>
    </PageShell>
  )
}
