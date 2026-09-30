/**
 * Pořadí témat v ročníku. Bez importů schválně: používá ho server při
 * načítání knihovny i prohlížeč při přeskládání, ať obě strany řadí stejně.
 *
 * `topics.position` je 0, dokud témata nikdo ručně nepřeskládal; pak se řadí
 * podle české abecedy, a to tak, že čísla v názvu se berou jako čísla —
 * materiály mívají v názvu číslo kapitoly („7.4 Hmyz…") a látka jde po nich.
 * SQL řazení to neumí: `Č` dává za `Z` a `10.` před `2.`.
 *
 * Po ručním přeskládání mají témata ročníku pozice 1…n. Téma přidané až
 * potom má 0 a zařadí se za ně podle abecedy, dokud ho někdo nepřesune.
 */

const COLLATOR = new Intl.Collator('cs', { numeric: true, sensitivity: 'base' })

export function porovnatNazvy(a: string, b: string): number {
  return COLLATOR.compare(a, b)
}

export function seraditTemata<T extends { name: string; position: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const rucniA = a.position > 0
    const rucniB = b.position > 0
    if (rucniA && rucniB && a.position !== b.position) return a.position - b.position
    if (rucniA !== rucniB) return rucniA ? -1 : 1
    return porovnatNazvy(a.name, b.name)
  })
}
