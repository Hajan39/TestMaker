import 'server-only'
import { t } from '@testmaker/core/i18n'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import { auditLog, db, schools, sessions, users } from '@/db'
import { newId } from '@/lib/ids'
import { isAdministratorRole, roleCanEdit, roleCanManage, type Role } from '@/lib/role'
import { DEFAULT_ACCOUNT_ID } from '@/lib/defaultAccount'
import {
  SESSION_MAX_MS,
  SESSION_TTL_MS,
  SESSION_COOKIE,
  authMode,
  verifySession,
  signSession,
  sessionCookie,
} from '@/lib/session'

/**
 * Who is working right now and in which school. This is the only entry point
 * to identity — functions in `lib/*` take `Scope` as their first parameter so
 * they cannot be called without a scope and the compiler points it out.
 *
 * `proxy.ts` verifies the cookie signature without the database; only here
 * are the session and account rows loaded, so a revoked session or a blocked
 * account is detected.
 */
export interface Scope {
  readonly schoolId: string
  readonly userId: string
  readonly role: Role
}

export interface SignedInUser extends Scope {
  name: string
  email: string
  /** Name of the school currently worked in (the selected one for an administrator). */
  schoolName: string
  /**
   * The school the account belongs to. For an administrator it may differ
   * from `schoolId` after switching elsewhere; for other roles it is the same.
   */
  homeSchoolId: string
  sid: string
  mustChangePassword: boolean
  /** Does the account have a password? Google-only accounts have nothing to change. Missing = unknown (local run). */
  hasPassword?: boolean
}

export { DEFAULT_ACCOUNT_ID } from './defaultAccount'

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in')
    this.name = 'NotSignedInError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = t('api:forbidden')) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/**
 * The signed-in person for this request. React's `cache()` makes the pair of
 * queries run once even when the page and every server function below it ask
 * for the user.
 */
export const currentUser = cache(async (): Promise<SignedInUser | null> => {
  if (authMode() === 'vypnuto') return defaultUser()

  const cookieStore = await cookies()
  const session = await verifySession(
    cookieStore.get(SESSION_COOKIE)?.value,
    process.env.AUTH_SECRET ?? '',
  )
  if (!session) return null

  const [row] = await db
    .select({
      userId: users.id,
      schoolId: users.schoolId,
      role: users.role,
      name: users.name,
      email: users.email,
      school: schools.name,
      sessionVersion: users.sessionVersion,
      mustChangePassword: users.mustChangePassword,
      passwordHash: users.passwordHash,
      status: users.status,
      activeSchoolId: users.activeSchoolId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(schools, eq(schools.id, users.schoolId))
    .where(
      and(
        eq(sessions.id, session.sid),
        eq(sessions.userId, session.uid),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1)

  if (!row || row.status !== 'aktivni' || row.sessionVersion !== session.sv) return null
  // The role in the cookie decides in the gate (`proxy.ts`), which cannot see
  // the database. When it differs from the database, the cookie is stale —
  // otherwise after a role change a teacher would keep hitting Preview's
  // limits until she signs out herself.
  if (row.role !== session.role) return null

  // The session is in use, so the device is visibly alive; management uses
  // this to tell abandoned sign-ins apart.
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(sessions.id, session.sid))

  const selected = await selectedSchool(row)
  return {
    schoolId: selected?.id ?? row.schoolId,
    userId: row.userId,
    role: row.role,
    name: row.name,
    email: row.email,
    schoolName: selected?.name ?? row.school,
    homeSchoolId: row.schoolId,
    sid: session.sid,
    mustChangePassword: row.mustChangePassword,
    hasPassword: Boolean(row.passwordHash),
  }
})

/**
 * The school an administrator switched to. `null` means working in the home
 * school — always for other roles, for an administrator without a selection,
 * and also when the selected school has disappeared meanwhile (the foreign key
 * nulls it, but better safe than sorry).
 */
async function selectedSchool(row: {
  role: Role
  schoolId: string
  activeSchoolId: string | null
}): Promise<{ id: string; name: string } | null> {
  if (!isAdministratorRole(row.role) || !row.activeSchoolId || row.activeSchoolId === row.schoolId) {
    return null
  }
  const [school] = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .where(eq(schools.id, row.activeSchoolId))
    .limit(1)
  return school ?? null
}

/**
 * Without sign-in (local `next dev`, browser tests) work happens under a fixed
 * account. It must really exist — foreign keys of tests, puzzles and the queue
 * would otherwise have nothing to point to. Both `db/seed.ts` and
 * `scripts/seed-e2e.ts` create it.
 *
 * `E2E_UZIVATEL` can switch the identity; it applies only in this mode, so it
 * cannot bypass anything in a deployment.
 */
async function defaultUser(): Promise<SignedInUser | null> {
  const id = process.env.E2E_UZIVATEL || DEFAULT_ACCOUNT_ID
  const selection = {
    userId: users.id,
    schoolId: users.schoolId,
    role: users.role,
    name: users.name,
    email: users.email,
    school: schools.name,
    activeSchoolId: users.activeSchoolId,
  }

  const [fixed] = await db
    .select(selection)
    .from(users)
    .innerJoin(schools, eq(schools.id, users.schoolId))
    .where(eq(users.id, id))
    .limit(1)
  if (fixed) return withoutSignIn(fixed)

  /*
   * A seeded database has an account with a fixed id; one migrated from the
   * single-teacher version does not. So the app opens locally over it too,
   * the first manager is taken — otherwise development over real data would
   * end with an unhelpful "no such user" error.
   */
  const [firstManager] = await db
    .select(selection)
    .from(users)
    .innerJoin(schools, eq(schools.id, users.schoolId))
    .where(eq(users.role, 'spravce'))
    .orderBy(asc(users.createdAt))
    .limit(1)
  if (!firstManager) return null
  return withoutSignIn(firstManager)
}

async function withoutSignIn(row: {
  userId: string
  schoolId: string
  role: Role
  name: string
  email: string
  school: string
  activeSchoolId: string | null
}): Promise<SignedInUser> {
  const selected = await selectedSchool(row)
  return {
    userId: row.userId,
    role: row.role,
    name: row.name,
    email: row.email,
    schoolId: selected?.id ?? row.schoolId,
    schoolName: selected?.name ?? row.school,
    homeSchoolId: row.schoolId,
    sid: 'bez-prihlaseni',
    mustChangePassword: false,
  }
}

/** The signed-in person, or an exception the route handler turns into 401. */
export async function requireScope(): Promise<SignedInUser> {
  const user = await currentUser()
  if (!user) throw new NotSignedInError()
  return user
}

/**
 * The signed-in person for a server page. When the session is invalid the
 * page does not render and the browser goes to sign-in — throwing would show
 * the user the Next.js error screen instead of the form.
 */
export async function pageAccount(): Promise<SignedInUser> {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}

/** The signed-in person with one of the given roles, otherwise an exception for 403. */
export async function requireRole(...role: Role[]): Promise<SignedInUser> {
  const user = await requireScope()
  if (!role.includes(user.role)) throw new ForbiddenError()
  return user
}

/** The signed-in person allowed to change content (anyone except preview). */
export async function requireWrite(): Promise<SignedInUser> {
  const user = await requireScope()
  if (!roleCanEdit(user.role)) {
    throw new ForbiddenError(t('auth:readOnly'))
  }
  return user
}

export function canEditContent(scope: Scope): boolean {
  return roleCanEdit(scope.role)
}

export function canManage(scope: Scope): boolean {
  return roleCanManage(scope.role)
}

/** Scope for a queue run: there is no session, it comes from the job. */
export function scopeFromJob(job: { schoolId: string; requestedBy: string }): Scope {
  return { schoolId: job.schoolId, userId: job.requestedBy, role: 'ucitelka' }
}

/** Creates a session and returns the `Set-Cookie` header value. */
export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<string> {
  const [account] = await db
    .select({
      schoolId: users.schoolId,
      role: users.role,
      sessionVersion: users.sessionVersion,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!account) throw new Error('Account does not exist')

  const sid = newId()
  const now = Date.now()
  await db.insert(sessions).values({
    id: sid,
    userId,
    expiresAt: new Date(now + SESSION_MAX_MS).toISOString(),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  await db
    .update(users)
    .set({ lastLoginAt: new Date(now).toISOString(), failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, userId))

  const token = await signSession(
    {
      uid: userId,
      sch: account.schoolId,
      sid,
      role: account.role,
      sv: account.sessionVersion,
      exp: now + SESSION_TTL_MS,
      ...(account.mustChangePassword ? { zh: true } : {}),
    },
    process.env.AUTH_SECRET ?? '',
  )
  return sessionCookie(token)
}

export async function endSession(sid: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, sid), isNull(sessions.revokedAt)))
}

/** Signs the account out of all devices at once. */
export { revokeAllSessionsStandalone as revokeAllSessions } from './accountService'

export interface AuditEntry {
  schoolId?: string | null
  userId?: string | null
  action: string
  entity?: string | null
  entityId?: string | null
  detail?: unknown
  severity?: 'info' | 'chyba'
  ip?: string | null
}

/**
 * Writes to the event log. It must never break the action it describes —
 * so an error is only logged.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const detail = await withAdministratorFlag(entry)
    await db.insert(auditLog).values({
      id: newId(),
      schoolId: entry.schoolId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      detail,
      severity: entry.severity ?? 'info',
      ip: entry.ip ?? null,
    })
  } catch (error) {
    console.error('Failed to write audit event:', error)
  }
}

/**
 * When an administrator writes an event outside their home school, it gets a
 * flag — that school's manager then sees in the log that an outsider touched
 * it. It is derived from the account, not the caller, so no place can forget it.
 */
async function withAdministratorFlag(entry: AuditEntry): Promise<unknown> {
  const detail = entry.detail ?? null
  if (!entry.userId || !entry.schoolId) return detail
  const [author] = await db
    .select({ role: users.role, schoolId: users.schoolId })
    .from(users)
    .where(eq(users.id, entry.userId))
    .limit(1)
  if (!author || !isAdministratorRole(author.role) || author.schoolId === entry.schoolId) return detail
  const base = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : detail === null ? {} : { hodnota: detail }
  return { ...base, administrator: true }
}

/** Caller address from the headers behind Vercel; for the attempt counter and the log. */
export async function callerAddress(): Promise<string | null> {
  const requestHeaders = await headers()
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

/**
 * Wrapper for route handlers: finds the signed-in person, checks the role and
 * turns a rejection into a response with a user-facing message. Without it
 * every handler would start with the same five try/catch lines and some would
 * forget them.
 */
export async function withScope(
  handler: (account: SignedInUser) => Promise<Response> | Response,
  options: { role?: Role[]; write?: boolean } = {},
): Promise<Response> {
  try {
    const account = options.role
      ? await requireRole(...options.role)
      : options.write
        ? await requireWrite()
        : await requireScope()
    return await handler(account)
  } catch (error) {
    const response = accessErrorResponse(error)
    if (response) return response
    // A broken request body (`request.json()`) is a client error, not a server one.
    if (error instanceof SyntaxError) {
      return Response.json({ error: t('api:badRequestBody') }, { status: 400 })
    }
    // Without this the client would get a 500 with an empty body and show the
    // browser's English error. The raw text stays in the server log.
    console.error('Unexpected API error:', error)
    return Response.json(
      { error: t('api:serverError') },
      { status: 500 },
    )
  }
}

/** Response for exceptions from `requireScope`/`requireRole` in route handlers. */
export function accessErrorResponse(error: unknown): Response | null {
  if (error instanceof NotSignedInError) {
    return Response.json({ error: t('api:notSignedIn') }, { status: 401 })
  }
  if (error instanceof ForbiddenError) {
    return Response.json({ error: error.message }, { status: 403 })
  }
  return null
}

/** "Belongs to my school" condition for queries over a table with a `school_id` column. */
export function inSchool(scope: Scope, table: { schoolId: AnyColumn }) {
  return eq(table.schoolId, scope.schoolId)
}

/**
 * "It is mine" condition — school and owner. An administrator has full rights
 * in the selected school, so only the school condition applies to them.
 */
export function ownedBy(scope: Scope, table: { schoolId: AnyColumn; ownerId: AnyColumn }) {
  if (isAdministratorRole(scope.role)) return eq(table.schoolId, scope.schoolId)
  return and(eq(table.schoolId, scope.schoolId), eq(table.ownerId, scope.userId))
}

/**
 * A test that is visible: one's own, or shared with colleagues. A manager does
 * not get other people's tests — only in the whole-school backup. An
 * administrator sees all of them in the selected school.
 */
export function visibleTest(
  scope: Scope,
  table: { schoolId: AnyColumn; ownerId: AnyColumn; visibility: AnyColumn },
) {
  if (isAdministratorRole(scope.role)) return eq(table.schoolId, scope.schoolId)
  return and(
    eq(table.schoolId, scope.schoolId),
    or(eq(table.ownerId, scope.userId), eq(table.visibility, 'skola')),
  )
}

type AnyColumn = Parameters<typeof eq>[0]
