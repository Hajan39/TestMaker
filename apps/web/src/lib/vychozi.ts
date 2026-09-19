/**
 * Účet, pod kterým aplikace pracuje, když je přihlašování vypnuté (lokální
 * `next dev` a testy v prohlížeči). Vlastní modul bez závislostí, protože ho
 * potřebují i skripty spouštěné přes `tsx`, kde se `server-only` nerozřeší.
 */
export const VYCHOZI_UCET_ID = 'vyvoj-spravce'
