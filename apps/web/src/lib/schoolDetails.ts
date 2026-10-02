/**
 * A school's address and contacts. Without imports: both the form in the
 * browser and the server read it, so both sides know the same fields. Labels
 * and placeholders live in `admin:schoolForm.details.<key>`. All are optional
 * — a school works with just a name.
 */

export const SCHOOL_DETAIL_KEYS = [
  'street',
  'city',
  'postalCode',
  'website',
  'email',
  'phone',
  'ico',
  'principal',
] as const

export type SchoolDetailKey = (typeof SCHOOL_DETAIL_KEYS)[number]

/** Details as they are in the form: an empty string means "not filled in". */
export type SchoolDetails = Record<SchoolDetailKey, string>

export const EMPTY_DETAILS: SchoolDetails = Object.fromEntries(
  SCHOOL_DETAIL_KEYS.map((key) => [key, '']),
) as SchoolDetails

/**
 * Value to store. Empty is `NULL`; a website gets `https://` when someone typed
 * it without one ("www.skola.cz"), so it can become a link.
 */
export function normalizeDetail(key: SchoolDetailKey, input: string | null | undefined): string | null {
  const value = (input ?? '').trim()
  if (!value) return null
  if (key === 'website' && !/^https?:\/\//i.test(value)) return `https://${value}`
  return value
}

/** Details from a database row into the form. */
export function detailsFromRow(row: { [K in SchoolDetailKey]: string | null }): SchoolDetails {
  return Object.fromEntries(SCHOOL_DETAIL_KEYS.map((key) => [key, row[key] ?? ''])) as SchoolDetails
}
