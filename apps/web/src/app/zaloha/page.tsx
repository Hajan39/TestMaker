import { PageShell } from '@testmaker/ui'
import { db } from '@/db'
import { countRows } from '@/lib/backup'
import { roleCanManage } from '@/lib/role'
import { pageAccount } from '@/lib/user'
import { t } from '@testmaker/core/i18n'
import { BackupScreen } from './BackupScreen'

export function generateMetadata() {
  return { title: t('backup:metaTitle') }
}

// The counts must match what is in the library right now — otherwise after a
// restore the page would show numbers from before it.
export const dynamic = 'force-dynamic'

export default async function BackupPage() {
  // The backup is the whole school including other people's tests — so only a manager sees it.
  const account = await pageAccount()
  if (!roleCanManage(account.role)) {
    return (
      <PageShell>
        <p className="text-sm text-fg-soft">
          {t('backup:managerOnly')}
        </p>
      </PageShell>
    )
  }

  const counts = await countRows(db, { schoolId: account.schoolId })

  return (
    <PageShell>
      <BackupScreen counts={counts} />
    </PageShell>
  )
}
