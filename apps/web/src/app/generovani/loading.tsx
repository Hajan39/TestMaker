import { Delayed, LoadingHeading, LoadingTable, PageShell } from '@testmaker/ui'

/** Přechod na přehled generování: kostra výpisu témat o stejných řádcích. */
export default function QueueLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám přehled generování…" className="space-y-5">
        <LoadingHeading stats />
        <LoadingTable rows={5} columns={3} />
      </Delayed>
    </PageShell>
  )
}
