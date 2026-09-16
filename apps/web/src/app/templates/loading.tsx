import { Delayed, LoadingCards, LoadingHeading, PageShell } from '@testmaker/ui'

/**
 * Přechod na šablony. Náhledy jsou skutečná PDF, takže se na ně čeká nejdél
 * ze všech obrazovek — kostra tu má poměr stran A4, aby se mřížka po dokreslení
 * náhledů nepřeskládala.
 */
export default function TemplatesLoading() {
  return (
    <PageShell>
      <Delayed label="Načítám šablony…" className="space-y-5">
        <LoadingHeading />
        <LoadingCards count={3} />
      </Delayed>
    </PageShell>
  )
}
