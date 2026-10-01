import { Delayed, LoadingHeading, LoadingList, LoadingTiles, ThreePane } from '@testmaker/ui'

/**
 * Obecná záložní kostra. Úvod má tři sloupce stejně jako téma — rám se
 * vykreslí hned a kostra vyplní jen jeho obsah, aby sloupce po načtení
 * zůstaly na místě. Jednostránkové obrazovky (import, správa, záloha,
 * administrace) mají vlastní `loading.tsx` s `PageShell`.
 */
export default function FallbackLoading() {
  return (
    <ThreePane first={<LoadingList items={8} />} second={<LoadingList items={10} />}>
      <Delayed label="Načítám…" className="space-y-5">
        <LoadingHeading stats />
        <LoadingTiles count={6} />
      </Delayed>
    </ThreePane>
  )
}
