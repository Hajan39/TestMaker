/**
 * Doména a slug školy z textu. Bez importů: čte je aplikace i skript
 * `scripts/uzivatel.ts`, který zakládá první školu mimo Next.js.
 */

/**
 * Doména tak, jak ji vrací Google v `hd`: malými písmeny, bez zavináče
 * a mezer. Prázdná znamená „bez přihlášení Googlem" a ukládá se jako `NULL`,
 * aby víc škol bez domény nenaráželo na unikátní index.
 */
export function normalizovatDomenu(vstup: string | null | undefined): string | null {
  const domena = (vstup ?? '').trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase()
  return domena || null
}

/** Slug z názvu: bez diakritiky, malými písmeny, slova spojená pomlčkou. */
export function slugZNazvu(nazev: string): string {
  const slug = nazev
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'skola'
}
