import 'server-only'
import { and, asc, count, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { t } from '@testmaker/core/i18n'
import { db, schools, users } from '@/db'
import { seedTemplates } from '@/db/templates'
import { newId } from '@/lib/ids'
import { isAdministratorRole, roleCanManage } from '@/lib/role'
import { normalizeDomain, slugFromName } from '@/lib/schoolText'
import { normalizeDetail, SCHOOL_DETAIL_KEYS, type SchoolDetailKey } from '@/lib/schoolDetails'
import type { Scope } from '@/lib/user'

/**
 * Schools: a manager edits their own school; an administrator creates and edits
 * any school and switches to another one. Anyone without rights to a school
 * gets the same answer as if it did not exist.
 */

export type SchoolRow = {
  id: string
  name: string
  slug: string
  googleDomain: string | null
  googleAutoJoin: boolean
  accountCount: number
} & { [K in SchoolDetailKey]: string | null }

export type SchoolChanges = {
  name?: string
  googleDomain?: string | null
  googleAutoJoin?: boolean
} & { [K in SchoolDetailKey]?: string | null }

const detailsSchema = z.object(
  Object.fromEntries(SCHOOL_DETAIL_KEYS.map((key) => [key, z.string().max(200).nullable().optional()])) as {
    [K in SchoolDetailKey]: z.ZodOptional<z.ZodNullable<z.ZodString>>
  },
)

/** Request body for editing a school; shared by management and administration. */
export const schoolChangesSchema = z
  .object({
    name: z.string().max(200).optional(),
    googleDomain: z.string().max(200).nullable().optional(),
    googleAutoJoin: z.boolean().optional(),
  })
  .extend(detailsSchema.shape)

/** Address and contacts to store — only the fields that came in the request. */
function detailsToStore(changes: SchoolChanges): Partial<Record<SchoolDetailKey, string | null>> {
  const patch: Partial<Record<SchoolDetailKey, string | null>> = {}
  for (const key of SCHOOL_DETAIL_KEYS) {
    if (changes[key] !== undefined) patch[key] = normalizeDetail(key, changes[key])
  }
  return patch
}

export type SchoolResult = { ok: true; id: string } | { ok: false; error: string; status: number }

const notFound = (): SchoolResult => ({ ok: false, error: t('admin:errors.schoolNotFound'), status: 404 })
const untitled = (): SchoolResult => ({ ok: false, error: t('admin:errors.schoolUntitled'), status: 400 })

export { normalizeDomain, slugFromName } from '@/lib/schoolText'

/** All schools — administrator only, otherwise `null`. */
export async function listSchools(scope: Scope): Promise<SchoolRow[] | null> {
  if (!isAdministratorRole(scope.role)) return null
  const rows = await db
    .select({
      id: schools.id,
      name: schools.name,
      slug: schools.slug,
      googleDomain: schools.googleDomain,
      googleAutoJoin: schools.googleAutoJoin,
      street: schools.street,
      city: schools.city,
      postalCode: schools.postalCode,
      website: schools.website,
      email: schools.email,
      phone: schools.phone,
      ico: schools.ico,
      principal: schools.principal,
      accountCount: count(users.id),
    })
    .from(schools)
    .leftJoin(users, eq(users.schoolId, schools.id))
    .groupBy(schools.id)
    .orderBy(asc(schools.name))
  return rows
}

/** Creates a school including the built-in templates. Administrator only. */
export async function createSchool(scope: Scope, input: SchoolChanges): Promise<SchoolResult> {
  if (!isAdministratorRole(scope.role)) return notFound()
  const name = input.name?.trim()
  if (!name) return untitled()
  const googleDomain = normalizeDomain(input.googleDomain)
  const collision = await domainCollision(googleDomain, null)
  if (collision) return collision

  const id = newId()
  await db.insert(schools).values({
    id,
    name,
    slug: await freeSlug(slugFromName(name)),
    googleDomain,
    googleAutoJoin: input.googleAutoJoin ?? false,
    ...detailsToStore(input),
  })
  await seedTemplates(db, id)
  return { ok: true, id }
}

/**
 * Edits a school. A manager may edit only the one they work in; an administrator
 * any.
 */
export async function updateSchool(
  scope: Scope,
  schoolId: string,
  changes: SchoolChanges,
): Promise<SchoolResult> {
  const allowed = isAdministratorRole(scope.role) || (roleCanManage(scope.role) && schoolId === scope.schoolId)
  if (!allowed) return notFound()
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.id, schoolId)).limit(1)
  if (!school) return notFound()

  const patch: Partial<typeof schools.$inferInsert> = detailsToStore(changes)
  if (changes.name !== undefined) {
    const name = changes.name.trim()
    if (!name) return untitled()
    patch.name = name
  }
  if (changes.googleDomain !== undefined) {
    const googleDomain = normalizeDomain(changes.googleDomain)
    const collision = await domainCollision(googleDomain, schoolId)
    if (collision) return collision
    patch.googleDomain = googleDomain
  }
  if (changes.googleAutoJoin !== undefined) patch.googleAutoJoin = changes.googleAutoJoin

  if (Object.keys(patch).length > 0) {
    await db.update(schools).set(patch).where(eq(schools.id, schoolId))
  }
  return { ok: true, id: schoolId }
}

/**
 * Switches the administrator to a school. The home school clears the choice so
 * `activeSchoolId` is not kept needlessly. Returns `false` when the school does not exist or
 * the caller is not an administrator.
 */
export async function switchSchool(
  scope: Scope & { homeSchoolId: string },
  schoolId: string,
): Promise<boolean> {
  if (!isAdministratorRole(scope.role)) return false
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.id, schoolId)).limit(1)
  if (!school) return false
  await db
    .update(users)
    .set({ activeSchoolId: schoolId === scope.homeSchoolId ? null : schoolId })
    .where(eq(users.id, scope.userId))
  return true
}

async function domainCollision(googleDomain: string | null, schoolId: string | null): Promise<SchoolResult | null> {
  if (!googleDomain) return null
  const [other] = await db
    .select({ name: schools.name })
    .from(schools)
    .where(
      schoolId
        ? and(eq(schools.googleDomain, googleDomain), ne(schools.id, schoolId))
        : eq(schools.googleDomain, googleDomain),
    )
    .limit(1)
  if (!other) return null
  return {
    ok: false,
    error: t('admin:errors.domainTaken', { domain: googleDomain, school: other.name }),
    status: 409,
  }
}

async function freeSlug(base: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`
    const [taken] = await db.select({ id: schools.id }).from(schools).where(eq(schools.slug, slug)).limit(1)
    if (!taken) return slug
  }
}
