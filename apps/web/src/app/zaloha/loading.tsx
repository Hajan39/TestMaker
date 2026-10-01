import { Delayed, LoadingCard, LoadingHeading, PageShell } from '@testmaker/ui'

/** Přechod na zálohu: počítají se všechny tabulky školy, chvíli to trvá. */
export default function ZalohaLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám zálohu…" className="space-y-5">
        <LoadingHeading />
        <LoadingCard lines={4} />
      </Delayed>
    </PageShell>
  )
}
