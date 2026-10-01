import type { ReactNode } from 'react'
import { ThreePane } from '@testmaker/ui'
import { LibrarySidebar } from '@/components/LibrarySidebar'
import { TopicList } from '@/components/TopicList'
import type { GradeNode, SubjectNode } from '@/lib/library'

/**
 * Three columns shared by home, the class page and the topic page: the first
 * holds subjects and grades, the second the selected grade's topics, the third
 * the content the page brings itself. Whoever has nothing in the library yet
 * gets the content without the frame — an empty sidebar would only suggest
 * something is missing.
 */
export function LibraryPanes({
  tree,
  grade,
  activeTopicId,
  contentLabel,
  children,
}: {
  tree: SubjectNode[]
  grade: GradeNode | null
  activeTopicId?: string
  /** Name of the content area (and its tab on a phone); defaults to "Obsah tématu". */
  contentLabel?: string
  children: ReactNode
}) {
  if (tree.length === 0) return <>{children}</>

  return (
    <ThreePane
      first={<LibrarySidebar tree={tree} activeGradeId={grade?.id} />}
      second={<TopicList grade={grade} activeTopicId={activeTopicId} />}
      contentLabel={contentLabel}
    >
      {children}
    </ThreePane>
  )
}
