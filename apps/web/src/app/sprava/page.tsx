import { asc, desc, eq } from 'drizzle-orm'
import { PageShell } from '@testmaker/ui'
import { auditLog, db, schools, users } from '@/db'
import { loadAiQuality } from '@/lib/aiQuality'
import { countJobs } from '@/lib/jobs'
import { aiStatus } from '@/lib/ai'
import { loadPromptRules } from '@/lib/promptRules'
import { authMode } from '@/lib/session'
import { ucetStranky } from '@/lib/uzivatel'
import { SpravaScreen } from './SpravaScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Správa – TestMaker' }

/** Kolik událostí se ukáže naráz. Starší si správce dohledá filtrem. */
const UDALOSTI = 100

/**
 * Správa školy: účty, události a chyby, provoz. Sem se dostane jedině
 * správce — hlídá to brána i tahle stránka.
 */
export default async function SpravaPage() {
  const ucet = await ucetStranky()
  if (ucet.role !== 'spravce') {
    return (
      <PageShell>
        <p className="text-sm text-fg-soft">Do správy má přístup jen správce školy.</p>
      </PageShell>
    )
  }

  const [uzivatele, udalosti, [skola], fronta, aiKvalita, pravidla] = await Promise.all([
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
      .where(eq(users.schoolId, ucet.schoolId))
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
        kdo: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(eq(auditLog.schoolId, ucet.schoolId))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(UDALOSTI),
    db
      .select({ name: schools.name, googleDomain: schools.googleDomain })
      .from(schools)
      .where(eq(schools.id, ucet.schoolId))
      .limit(1),
    countJobs(ucet),
    loadAiQuality(ucet),
    loadPromptRules(ucet),
  ])
  const ai = aiStatus()

  return (
    <PageShell>
      <SpravaScreen
        ja={ucet.userId}
        skola={skola?.name ?? ''}
        googleDomain={skola?.googleDomain ?? null}
        uzivatele={uzivatele.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          status: row.status,
          // Ven jde jen „heslo má / nemá"; hash na obrazovku nepatří.
          maHeslo: Boolean(row.passwordHash),
          maGoogle: Boolean(row.googleSub),
          mustChangePassword: row.mustChangePassword,
          lastLoginAt: row.lastLoginAt,
        }))}
        udalosti={udalosti}
        fronta={fronta}
        aiKvalita={aiKvalita}
        pravidla={pravidla}
        aiConfigured={ai.configured}
        aiProblems={ai.problems}
        prihlasovani={authMode()}
      />
    </PageShell>
  )
}
