/**
 * Account roles and statuses. A tiny module with deliberately no imports: it is
 * read both by the database schema (which also runs under `tsx`, where the `@/`
 * alias does not resolve) and by `session.ts`, which must not pull in anything
 * from the database because it runs in the Edge runtime inside `proxy.ts`.
 * Labels live in the `admin` namespace (`admin:roles.<role>`,
 * `admin:statuses.<status>`).
 */

/**
 * - `ucitelka` — full work with content: import, generation, review, tests.
 *   Its UI label names both genders, as staff rooms have both; the key stays.
 * - `spravce` — additionally accounts, backups, settings and the event log.
 * - `nahled` — only reads and prints; changes nothing.
 * - `administrator` — above schools: creates them, switches between them and
 *   may do everything in each, private tests included. Granted only by the
 *   `scripts/user.ts` script, never offered in the app.
 */
export type Role = 'ucitelka' | 'spravce' | 'nahled' | 'administrator'

export const ROLES: readonly Role[] = ['ucitelka', 'spravce', 'nahled', 'administrator']

/** Roles a manager may assign in the app. Administrator is not among them. */
export const ASSIGNABLE_ROLES: readonly Role[] = ['ucitelka', 'spravce', 'nahled']

/** Who gets into school management. */
export const MANAGEMENT_ROLES: Role[] = ['spravce', 'administrator']

/**
 * - `aktivni` — the account can sign in.
 * - `ceka` — signed in via Google, but a manager has not assigned a role yet.
 * - `zablokovany` — access revoked; its records stay.
 */
export type UserStatus = 'aktivni' | 'ceka' | 'zablokovany'

/** Who may change content. Preview is the only role that may not. */
export function roleCanEdit(role: Role): boolean {
  return role !== 'nahled'
}

/** Who may enter management: accounts, backups, events. */
export function roleCanManage(role: Role): boolean {
  return role === 'spravce' || role === 'administrator'
}

/** Who may work above schools: create them and switch between them. */
export function isAdministratorRole(role: Role): boolean {
  return role === 'administrator'
}
