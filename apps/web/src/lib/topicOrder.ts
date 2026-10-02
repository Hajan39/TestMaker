/**
 * Order of topics within a grade. Deliberately without imports: the server uses
 * it when loading the library and the browser when reordering, so both sides
 * sort the same way.
 *
 * `topics.position` is 0 until someone reorders the topics manually; until then
 * they sort by the Czech alphabet, with numbers in the name taken as numbers —
 * materials often carry the chapter number in the name ("7.4 Insects…") and the
 * curriculum follows them. SQL ordering can't do that: it puts `Č` after `Z`
 * and `10.` before `2.`.
 *
 * After a manual reorder the grade's topics have positions 1…n. A topic added
 * afterwards has 0 and sorts after them alphabetically until someone moves it.
 */

const COLLATOR = new Intl.Collator('cs', { numeric: true, sensitivity: 'base' })

export function compareNames(a: string, b: string): number {
  return COLLATOR.compare(a, b)
}

export function sortTopics<T extends { name: string; position: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const manualA = a.position > 0
    const manualB = b.position > 0
    if (manualA && manualB && a.position !== b.position) return a.position - b.position
    if (manualA !== manualB) return manualA ? -1 : 1
    return compareNames(a.name, b.name)
  })
}
