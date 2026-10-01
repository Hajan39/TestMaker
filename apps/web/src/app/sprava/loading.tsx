import { Delayed, LoadingTable, LoadingHeading, PageShell } from '@testmaker/ui'

/** Přechod do správy školy: kostra jednostránkové obrazovky, ne tří sloupců knihovny. */
export default function SpravaLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám správu školy…" className="space-y-5">
        <LoadingHeading />
        <LoadingTable rows={6} columns={4} />
      </Delayed>
    </PageShell>
  )
}
