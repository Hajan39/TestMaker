/**
 * School domain and slug from text. No imports: used by the app and by the
 * `scripts/user.ts` script, which creates the first school outside Next.js.
 */

/**
 * The domain as Google returns it in `hd`: lowercase, no at sign and no
 * spaces. Empty means "no Google sign-in" and is stored as `NULL`, so several
 * schools without a domain do not collide on the unique index.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  const domain = (input ?? '').trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase()
  return domain || null
}

/** Slug from a name: no diacritics, lowercase, words joined by hyphens. */
export function slugFromName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'skola'
}
