import { Delayed, LoadingHeading, LoadingTable, PageShell } from '@testmaker/ui'

/** Přechod na seznam testů: kostra tabulky o stejných řádcích jako ta skutečná. */
export default function TestsLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám testy…" className="space-y-5">
        <LoadingHeading />
        <LoadingTable rows={5} columns={6} />
      </Delayed>
    </PageShell>
  )
}
