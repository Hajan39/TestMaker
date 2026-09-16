import { Delayed, LoadingHeading, LoadingTable, PageShell } from '@testmaker/ui'

/** Přechod na banku otázek. Načítají se otázky ze všech témat, což chvíli trvá. */
export default function QuestionsLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám banku otázek…" className="space-y-4">
        <LoadingHeading />
        <LoadingTable rows={8} columns={5} />
      </Delayed>
    </PageShell>
  )
}
