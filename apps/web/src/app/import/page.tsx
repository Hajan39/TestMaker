import { PageShell } from '@testmaker/ui'
import { loadLibraryTree } from '@/lib/library'
import { ImportClient } from './ImportClient'
import { pageAccount } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export function generateMetadata() {
  return { title: t('library:import.metaTitle') }
}

// Suggested subjects and grades must match what is currently in the library.
export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const account = await pageAccount()
  const tree = await loadLibraryTree(account)
  // Library subjects and grades are suggested in the preview so that a second
  // "PŘÍRODOPIS" doesn't appear next to "Přírodopis" just because of letter case.
  const library = tree.map((subject) => ({
    subject: subject.name,
    grades: subject.grades.map((grade) => grade.name).filter(Boolean),
  }))

  return (
    <PageShell>
      <div className="space-y-4">
        <div>
          <h1 className="ui-page-title">{t('library:import.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-soft">{t('library:import.intro')}</p>
        </div>
        <ImportClient library={library} />
      </div>
    </PageShell>
  )
}
