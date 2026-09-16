/**
 * Pomocníci vykreslení, které používá PDF i papírová stránka ve skladači
 * testu. Jsou tu proto, aby obrazovka a papír nemohly říkat každý něco
 * jiného: číslování mezer v doplňovačce, značky prázdných buněk v tabulce
 * i zápis bodů má jedinou definici.
 *
 * Tenhle soubor nesmí sáhnout na `@react-pdf/renderer` — vtahuje se do
 * prohlížeče, kam vykreslovač PDF nepatří.
 */

export { LETTERS, questionLabel } from './styles'
export { displayOrder } from './shuffle'
export { formatAnswer } from './answerKey'

/** Body s desetinnou čárkou podle českého úzu, celá čísla bez zbytečné nuly. */
export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1).replace('.', ',')
}

/**
 * Zadání doplňovačky, ve kterém jsou místa k doplnění (`___`) nahrazená
 * očíslovanou linkou. Týmiž čísly se na mezery odkazuje klíč, takže se
 * odpovědi nemusí dopočítávat podle pořadí v textu.
 */
export function numberedBlanks(text: string): string {
  let blankNumber = 0
  return (
    text
      .replace(/___/g, () => {
        blankNumber += 1
        return ` (${blankNumber}) ______________ `
      })
      // Mezery kolem značky drží čitelnost i tam, kde je „___“ přilepené ke
      // slovu; tady se jen uklidí, co tím vzniklo navíc.
      .replace(/ {2,}/g, ' ')
      .replace(/ ([,.;:!?])/g, '$1')
      .trim()
  )
}

/**
 * Čísla prázdných buněk doplňovací tabulky v pořadí čtení po řádcích;
 * vyplněná buňka má `null`. Čísla odpovídají pořadí odpovědí v klíči.
 */
export function tableBlankNumbers(rows: (string | null)[][]): (number | null)[][] {
  let blankNumber = 0
  return rows.map((row) => row.map((cell) => (cell ? null : (blankNumber += 1))))
}
