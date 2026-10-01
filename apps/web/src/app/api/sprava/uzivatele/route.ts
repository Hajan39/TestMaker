import { t } from '@testmaker/core/i18n'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schools, users } from '@/db'
import { generatePassword, hashPassword, checkPasswordStrength } from '@/lib/password'
import { newId } from '@/lib/ids'
import { MANAGEMENT_ROLES, ROLES, ASSIGNABLE_ROLES, isAdministratorRole, type Role } from '@/lib/role'
import { revokeAllSessions, withScope, writeAudit } from '@/lib/user'

export const runtime = 'nodejs'

const roleSchema = z.enum(ROLES as unknown as [Role, ...Role[]])

/**
 * The administrator role is granted only by the script at the database, so a leaked
 * manager account cannot be promoted to administrator through the app. The schema knows
 * the role (otherwise no clear message could be returned); it is rejected only here.
 */
function assignable(role: Role | undefined): boolean {
  return role === undefined || ASSIGNABLE_ROLES.includes(role)
}

const createSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(200),
  role: roleSchema.default('ucitelka'),
})

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  role: roleSchema.optional(),
  status: z.enum(['aktivni', 'ceka', 'zablokovany']).optional(),
  /** `password` generates a new one and returns it once in the response. */
  password: z.literal(true).optional(),
  /** Signs the account out of all devices. */
  odhlasit: z.literal(true).optional(),
})

/** The school's account list — the core of the management screen. */
export async function GET() {
  return withScope(
    async (account) => {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          status: users.status,
          hasPassword: users.passwordHash,
          hasGoogle: users.googleSub,
          mustChangePassword: users.mustChangePassword,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.schoolId, account.schoolId))
        .orderBy(asc(users.name))

      const [school] = await db
        .select({ name: schools.name, googleDomain: schools.googleDomain })
        .from(schools)
        .where(eq(schools.id, account.schoolId))
        .limit(1)

      return Response.json({
        school,
        users: rows.map((row) => ({
          ...row,
          // The hash never goes out; it is enough to see whether there is a password at all.
          hasPassword: Boolean(row.hasPassword),
          hasGoogle: Boolean(row.hasGoogle),
        })),
      })
    },
    { role: MANAGEMENT_ROLES },
  )
}

/** Creates an account. The password is generated and shown once — the manager hands it over in person. */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
      const parsed = createSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: t('admin:errors.invalidData') }, { status: 400 })
      if (!assignable(parsed.data.role)) {
        return Response.json({ error: t('admin:errors.roleNotAssignable') }, { status: 400 })
      }

      const email = parsed.data.email.trim().toLowerCase()
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      if (existing) {
        return Response.json({ error: t('admin:errors.accountExists', { email }) }, { status: 409 })
      }

      const password = generatePassword()
      const id = newId()
      await db.insert(users).values({
        id,
        schoolId: account.schoolId,
        email,
        name: parsed.data.name.trim(),
        role: parsed.data.role,
        passwordHash: await hashPassword(password),
        // The first sign-in ends at the password change: what the manager dictated
        // is needlessly known to someone else.
        mustChangePassword: true,
        createdBy: account.userId,
      })
      await writeAudit({
        schoolId: account.schoolId,
        userId: account.userId,
        action: 'ucet-zalozen',
        entity: 'user',
        entityId: id,
        detail: { email, role: parsed.data.role },
      })

      return Response.json({ id, password })
    },
    { role: MANAGEMENT_ROLES },
  )
}

/** Account edit: name, role, status, password reset, sign-out from all devices. */
export async function PATCH(request: Request) {
  return withScope(
    async (account) => {
      const parsed = updateSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: t('admin:errors.invalidData') }, { status: 400 })
      if (!assignable(parsed.data.role)) {
        return Response.json({ error: t('admin:errors.roleNotAssignable') }, { status: 400 })
      }

      const [target] = await db.select().from(users).where(eq(users.id, parsed.data.id)).limit(1)
      if (!target || target.schoolId !== account.schoolId) {
        return Response.json({ error: t('admin:errors.accountNotFound') }, { status: 404 })
      }
      if (isAdministratorRole(target.role)) {
        return Response.json({ error: t('admin:errors.adminScriptOnly') }, { status: 403 })
      }

      // The last manager must not disappear — otherwise nobody would get into management
      // and accounts could be changed only by the script at the database.
      const removesManager =
        target.role === 'spravce' &&
        ((parsed.data.role && parsed.data.role !== 'spravce') ||
          (parsed.data.status && parsed.data.status !== 'aktivni'))
      if (removesManager) {
        const managers = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.schoolId, account.schoolId),
              eq(users.role, 'spravce'),
              eq(users.status, 'aktivni'),
            ),
          )
        if (managers.length <= 1) {
          return Response.json(
            { error: t('admin:errors.lastManager') },
            { status: 409 },
          )
        }
      }

      const changes: Record<string, unknown> = {}
      if (parsed.data.name) changes.name = parsed.data.name.trim()
      if (parsed.data.role) changes.role = parsed.data.role
      if (parsed.data.status) changes.status = parsed.data.status

      let password: string | null = null
      if (parsed.data.password) {
        password = generatePassword()
        const problem = checkPasswordStrength(password)
        if (problem) return Response.json({ error: problem }, { status: 500 })
        changes.passwordHash = await hashPassword(password)
        changes.mustChangePassword = true
        changes.failedLogins = 0
        changes.lockedUntil = null
      }

      if (Object.keys(changes).length > 0) {
        await db.update(users).set(changes).where(eq(users.id, target.id))
      }
      // A password reset, blocking and an explicit sign-out must all drop open windows.
      if (password || parsed.data.odhlasit || parsed.data.status === 'zablokovany') {
        await revokeAllSessions(target.id)
      }

      await writeAudit({
        schoolId: account.schoolId,
        userId: account.userId,
        action: 'ucet-upraven',
        entity: 'user',
        entityId: target.id,
        detail: { ...parsed.data, password: undefined },
      })

      return Response.json({ ok: true, ...(password ? { password } : {}) })
    },
    { role: MANAGEMENT_ROLES },
  )
}

/**
 * Revoking access. The account is not deleted — authorship of questions and tests
 * and the event log hang on it; instead it is blocked and signed out.
 */
export async function DELETE(request: Request) {
  return withScope(
    async (account) => {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return Response.json({ error: t('admin:errors.missingId') }, { status: 400 })
      if (id === account.userId) {
        return Response.json({ error: t('admin:errors.cannotBlockSelf') }, { status: 409 })
      }

      const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1)
      if (!target || target.schoolId !== account.schoolId) {
        return Response.json({ error: t('admin:errors.accountNotFound') }, { status: 404 })
      }
      if (isAdministratorRole(target.role)) {
        return Response.json({ error: t('admin:errors.adminScriptOnly') }, { status: 403 })
      }

      await db.update(users).set({ status: 'zablokovany' }).where(eq(users.id, id))
      await revokeAllSessions(id)
      await writeAudit({
        schoolId: account.schoolId,
        userId: account.userId,
        action: 'ucet-zablokovan',
        entity: 'user',
        entityId: id,
        detail: { email: target.email },
      })
      return Response.json({ ok: true })
    },
    { role: MANAGEMENT_ROLES },
  )
}
