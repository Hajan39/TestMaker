import { LibraryPanes } from '@/components/LibraryPanes'
import { loadLibraryTree } from '@/lib/library'
import { pageAccount } from '@/lib/user'

export const dynamic = 'force-dynamic'

/** Wraps the topic detail in the same frame as the library so the columns stay put on navigation. */
export default async function TopicLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const account = await pageAccount()
  const { id } = await params
  const tree = await loadLibraryTree(account)
  const grade = tree.flatMap((s) => s.grades).find((g) => g.topics.some((t) => t.id === id)) ?? null

  return (
    <LibraryPanes tree={tree} grade={grade} activeTopicId={id}>
      {children}
    </LibraryPanes>
  )
}
