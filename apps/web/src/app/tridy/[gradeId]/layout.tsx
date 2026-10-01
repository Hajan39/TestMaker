import { LibraryPanes } from '@/components/LibraryPanes'
import { loadLibraryTree } from '@/lib/library'
import { pageAccount } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const dynamic = 'force-dynamic'

/** Wraps the class page in the same frame as a topic — this is the highlighted grade. */
export default async function ClassLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ gradeId: string }>
}) {
  const account = await pageAccount()
  const { gradeId } = await params
  const tree = await loadLibraryTree(account)
  const grade = tree.flatMap((s) => s.grades).find((g) => g.id === gradeId) ?? null

  return (
    <LibraryPanes tree={tree} grade={grade} contentLabel={t('library:grade.contentLabel')}>
      {children}
    </LibraryPanes>
  )
}
