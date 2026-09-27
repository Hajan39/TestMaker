import { Delayed, LoadingHeading, LoadingTiles, Skeleton } from '@testmaker/ui'

/**
 * Přechod na úvod. Úvod je od úklidu lišty jednosloupcový (dlaždice tříd bez
 * `ThreePane`) — kostra proto kopíruje jen tenhle jeden sloupec: hledání
 * nahoře, nadpis se statistikou a mřížka dlaždic.
 */
export default function HomeLoading() {
  return (
    <Delayed label="Načítám třídy…" className="space-y-5">
      <Skeleton className="h-9 max-w-md" />
      <LoadingHeading stats />
      <LoadingTiles count={6} />
    </Delayed>
  )
}
