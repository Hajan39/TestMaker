import { t } from '@testmaker/core/i18n'
import { PageShell } from '@testmaker/ui'
import { periodFrom, aiUsageOverview } from '@/lib/aiUsage'
import { listSchools } from '@/lib/schools'
import { pageAccount } from '@/lib/user'
import { AdminScreen } from './AdminScreen'
import { AiUsagePanel } from './AiUsagePanel'

export const dynamic = 'force-dynamic'
export function generateMetadata() {
  return { title: t('admin:schools.metaTitle') }
}

/**
 * Schools above schools: list, create, edit and switch. Administrator only;
 * the gateway keeps others out, and if not, the page pretends to be empty.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ dni?: string }>
}) {
  const account = await pageAccount()
  const { dni: days } = await searchParams
  const [schools, overview] = await Promise.all([listSchools(account), aiUsageOverview(account, periodFrom(days))])
  if (!schools || !overview) {
    return (
      <PageShell>
        <p className="text-sm text-fg-soft">{t('admin:schools.pageNotFound')}</p>
      </PageShell>
    )
  }
  return (
    <PageShell>
      <AdminScreen
        schools={schools}
        current={account.schoolId}
        homeSchool={account.homeSchoolId}
        aiUsage={<AiUsagePanel overview={overview} />}
      />
    </PageShell>
  )
}
