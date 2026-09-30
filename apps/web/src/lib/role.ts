/**
 * Role a stavy účtu. Vlastní maličký modul bez jediného importu schválně:
 * čtou ho jak schéma databáze (které běží i pod `tsx`, kde se alias `@/`
 * nerozřeší), tak `session.ts`, který nesmí do sebe vtáhnout nic z databáze,
 * protože běží v Edge runtime uvnitř `proxy.ts`.
 */

/**
 * - `ucitelka` — plná práce s obsahem: import, generování, kontrola, testy.
 *   V rozhraní „Učitel/ka", protože ve sborovně jsou obě pohlaví; klíč zůstává.
 * - `spravce` — navíc účty, zálohy, nastavení a záznam událostí.
 * - `nahled` — jen čte a tiskne; nic nemění.
 * - `administrator` — nad školami: zakládá je, přepíná se mezi nimi a v každé
 *   smí všechno včetně soukromých písemek. Přiděluje ho jen skript
 *   `scripts/uzivatel.ts`, v aplikaci se nenabízí.
 */
export type Role = 'ucitelka' | 'spravce' | 'nahled' | 'administrator'

export const ROLES: readonly Role[] = ['ucitelka', 'spravce', 'nahled', 'administrator']

/** Role, které smí přidělit správce v aplikaci. Administrátora mezi nimi není. */
export const ROLES_PRIDELITELNE: readonly Role[] = ['ucitelka', 'spravce', 'nahled']

/** Kdo se dostane do správy školy. */
export const ROLE_SPRAVY: Role[] = ['spravce', 'administrator']

export const ROLE_LABELS: Record<Role, string> = {
  ucitelka: 'Učitel/ka',
  spravce: 'Správce',
  nahled: 'Náhled',
  administrator: 'Administrátor',
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
  return role === 'spravce' || role === 'administrator'
}

/** Kdo smí nad školy: zakládat je a přepínat se mezi nimi. */
export function roleJeAdministrator(role: Role): boolean {
  return role === 'administrator'
}
