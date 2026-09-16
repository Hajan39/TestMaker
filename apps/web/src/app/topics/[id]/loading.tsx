import { Delayed, LoadingCard, LoadingHeading } from '@testmaker/ui'

/**
 * Přechod na detail tématu. Sloupce s ročníky a tématy drží layout nad tímhle
 * souborem, takže se překreslí jen obsahová část — kliknutí na téma v seznamu
 * tedy nerozsvítí kostru pod celou obrazovkou.
 */
export default function TopicLoading() {
  return (
    <Delayed label="Načítám téma…" className="space-y-5">
      <LoadingHeading stats />
      <LoadingCard lines={3} />
      <LoadingCard lines={4} />
    </Delayed>
  )
}
