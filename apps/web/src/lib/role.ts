/**
 * Role a stavy účtu. Vlastní maličký modul bez jediného importu schválně:
 * čtou ho jak schéma databáze (které běží i pod `tsx`, kde se alias `@/`
 * nerozřeší), tak `session.ts`, který nesmí do sebe vtáhnout nic z databáze,
 * protože běží v Edge runtime uvnitř `proxy.ts`.
 */

/**
 * - `ucitelka` — plná práce s obsahem: import, generování, kontrola, testy.
 * - `spravce` — navíc účty, zálohy, nastavení a záznam událostí.
 * - `nahled` — jen čte a tiskne; nic nemění.
 */
export type Role = 'ucitelka' | 'spravce' | 'nahled'

export const ROLES: readonly Role[] = ['ucitelka', 'spravce', 'nahled']

export const ROLE_LABELS: Record<Role, string> = {
  ucitelka: 'Učitelka',
  spravce: 'Správce',
  nahled: 'Náhled',
}

/**
 * - `aktivni` — účet se může přihlásit.
 * - `ceka` — přihlásil se přes Google, ale správce mu ještě nepřidělil roli.
 * - `zablokovany` — přístup odebrán; záznamy po něm zůstávají.
 */
export type UserStatus = 'aktivni' | 'ceka' | 'zablokovany'

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  aktivni: 'Aktivní',
  ceka: 'Čeká na schválení',
  zablokovany: 'Zablokovaný',
}

/** Kdo smí měnit obsah. Náhled je jediná role, která nesmí nic. */
export function roleMuzeMenit(role: Role): boolean {
  return role !== 'nahled'
}

/** Kdo smí do správy: účty, zálohy, události. */
export function roleMuzeSpravovat(role: Role): boolean {
  return role === 'spravce'
}
