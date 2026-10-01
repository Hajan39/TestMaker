import { Delayed, LoadingTable, LoadingHeading, PageShell } from '@testmaker/ui'

/** Přechod do administrace: přehled škol a použití AI je tabulka. */
export default function AdministraceLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám administraci…" className="space-y-5">
        <LoadingHeading />
        <LoadingTable rows={5} columns={4} />
      </Delayed>
    </PageShell>
  )
}
