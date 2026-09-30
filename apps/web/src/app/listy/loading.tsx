import { Delayed, LoadingHeading, LoadingTable, PageShell } from '@testmaker/ui'

/** Přechod na seznam listů: kostra tabulky o stejných řádcích jako ta skutečná. */
export default function WorksheetsLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám pracovní listy…" className="space-y-5">
        <LoadingHeading />
        <LoadingTable rows={5} columns={5} />
      </Delayed>
    </PageShell>
  )
}
