import { asc, desc, eq } from 'drizzle-orm'
import { t } from '@testmaker/core/i18n'
import { PageShell } from '@testmaker/ui'
import { auditLog, db, schools, users } from '@/db'
import { loadAiQuality } from '@/lib/aiQuality'
import { countJobs } from '@/lib/jobs'
import { aiStatus } from '@/lib/ai'
import { loadPromptRules, MAX_ACTIVE_PROMPT_RULES } from '@/lib/promptRules'
import { authMode } from '@/lib/session'
import { roleCanManage } from '@/lib/role'
import { EMPTY_DETAILS, detailsFromRow } from '@/lib/schoolDetails'
import { pageAccount } from '@/lib/user'
import { ManagementScreen } from './ManagementScreen'
import { MANAGEMENT_TABS, tabFrom, TAB_PARAM } from '@/lib/tabs'

export const dynamic = 'force-dynamic'
export function generateMetadata() {
  return { title: t('admin:management.metaTitle') }
}

/** How many events are shown at once. The manager finds older ones with a filter. */
const EVENT_LIMIT = 100

/**
 * School management: accounts, events and errors, operations. Only a manager
 * gets here — both the gateway and this page check it.
 */
export default async function ManagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const account = await pageAccount()
  const initialTab = tabFrom(MANAGEMENT_TABS, (await searchParams)[TAB_PARAM])
  if (!roleCanManage(account.role)) {
    return (
      <PageShell>
        <p className="text-sm text-fg-soft">{t('admin:management.noAccess')}</p>
      </PageShell>
    )
  }

  const [accounts, events, [school], queue, aiQuality, rules] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        passwordHash: users.passwordHash,
        googleSub: users.googleSub,
        mustChangePassword: users.mustChangePassword,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(eq(users.schoolId, account.schoolId))
      .orderBy(asc(users.name)),
    db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        detail: auditLog.detail,
        severity: auditLog.severity,
        who: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(eq(auditLog.schoolId, account.schoolId))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(EVENT_LIMIT),
    db
      .select({
        name: schools.name,
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
      })
      .from(schools)
      .where(eq(schools.id, account.schoolId))
      .limit(1),
    countJobs(account),
    loadAiQuality(account),
    loadPromptRules(account),
  ])
  const ai = aiStatus()

  return (
    <PageShell>
      <ManagementScreen
        me={account.userId}
        school={school?.name ?? ''}
        googleDomain={school?.googleDomain ?? null}
        googleAutoJoin={school?.googleAutoJoin ?? false}
        schoolDetails={school ? detailsFromRow(school) : EMPTY_DETAILS}
        users={accounts.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          status: row.status,
          // Only "has a password / has not" goes out; the hash does not belong on screen.
          hasPassword: Boolean(row.passwordHash),
          hasGoogle: Boolean(row.googleSub),
          mustChangePassword: row.mustChangePassword,
          lastLoginAt: row.lastLoginAt,
        }))}
        events={events}
        queue={queue}
        aiQuality={aiQuality}
        rules={rules}
        maxRules={MAX_ACTIVE_PROMPT_RULES}
        aiConfigured={ai.configured}
        aiProblems={ai.problems}
        authModeValue={authMode()}
        initialTab={initialTab}
      />
    </PageShell>
  )
}
