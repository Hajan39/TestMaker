/**
 * Návrat po přihlášení — jen cesta uvnitř aplikace, nikdy cizí adresa.
 * Bez závislostí, aby ho mohl použít i formulář v prohlížeči. Zpětné lomítko
 * prohlížeče čtou jako `/`, takže `/\cizi.cz` by vedlo ven stejně jako `//cizi.cz`.
 */
export function bezpecnyNavrat(dal: string | null | undefined): string {
  if (!dal || !dal.startsWith('/') || dal.startsWith('//') || dal.includes('\\')) return '/'
  return dal
}
