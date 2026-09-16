import { Delayed, LoadingHeading, LoadingList, LoadingTiles, ThreePane } from '@testmaker/ui'

/**
 * Přechod na knihovnu. Rám tří sloupců se vykreslí hned a kostra vyplní jen
 * jejich obsah — sloupce tak zůstanou na místě a po načtení se přepíše jen to,
 * co se doopravdy mění.
 */
export default function LibraryLoading() {
  return (
    <ThreePane first={<LoadingList items={8} />} second={<LoadingList items={10} />}>
      <Delayed label="Načítám knihovnu…" className="space-y-5">
        <LoadingHeading />
        <LoadingTiles count={6} />
      </Delayed>
    </ThreePane>
  )
}
