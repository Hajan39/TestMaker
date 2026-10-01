import { Delayed, LoadingCard, LoadingHeading, PageShell } from '@testmaker/ui'

/** Nový pracovní list je formulář, ne tabulka listů — kostra má jeho tvar. */
export default function NewWorksheetLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám formulář…" className="space-y-5">
        <LoadingHeading />
        <LoadingCard lines={6} />
      </Delayed>
    </PageShell>
  )
}
