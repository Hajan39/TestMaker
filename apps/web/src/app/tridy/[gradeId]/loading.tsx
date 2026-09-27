import { Delayed, LoadingHeading, LoadingList } from '@testmaker/ui'

/**
 * Přechod na stránku třídy: nadpis „Předmět · ročník" se statistikou a pod
 * ním seznam témat — kopíruje tvar `ClassTopics`, ne mřížku dlaždic (ta patří
 * úvodu).
 */
export default function ClassLoading() {
  return (
    <Delayed label="Načítám třídu…" className="space-y-5">
      <LoadingHeading stats />
      <LoadingList items={8} />
    </Delayed>
  )
}
