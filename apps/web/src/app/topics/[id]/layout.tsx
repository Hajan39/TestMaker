import { ThreePane } from '@testmaker/ui'
import { LibrarySidebar } from '@/components/LibrarySidebar'
import { TopicList } from '@/components/TopicList'
import { loadLibraryTree } from '@/lib/library'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'

/** Obaluje detail tématu stejným rámem jako knihovnu, aby sloupce při přechodu zůstaly. */
export default async function TopicLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const ucet = await ucetStranky()
  const { id } = await params
  const tree = await loadLibraryTree(ucet)
  const grade = tree.flatMap((s) => s.grades).find((g) => g.topics.some((t) => t.id === id)) ?? null

  return (
    <ThreePane
      first={<LibrarySidebar tree={tree} activeGradeId={grade?.id} />}
      second={<TopicList grade={grade} activeTopicId={id} />}
    >
      {children}
    </ThreePane>
  )
}
