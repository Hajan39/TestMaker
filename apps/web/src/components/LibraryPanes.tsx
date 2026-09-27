import type { ReactNode } from 'react'
import { ThreePane } from '@testmaker/ui'
import { LibrarySidebar } from '@/components/LibrarySidebar'
import { TopicList } from '@/components/TopicList'
import type { GradeNode, SubjectNode } from '@/lib/library'

/**
 * Tři sloupce sdílené úvodem, stránkou třídy i stránkou tématu: první sloupec
 * jsou předměty a ročníky, druhý témata zvoleného ročníku, třetí je obsah,
 * který si nese vlastní stránka. Kdo v knihovně ještě nic nemá, dostane
 * obsah bez rámu — prázdný postranní panel by jen budil dojem, že tam něco
 * chybí.
 */
export function LibraryPanes({
  tree,
  grade,
  activeTopicId,
  children,
}: {
  tree: SubjectNode[]
  grade: GradeNode | null
  activeTopicId?: string
  children: ReactNode
}) {
  if (tree.length === 0) return <>{children}</>

  return (
    <ThreePane
      first={<LibrarySidebar tree={tree} activeGradeId={grade?.id} />}
      second={<TopicList grade={grade} activeTopicId={activeTopicId} />}
    >
      {children}
    </ThreePane>
  )
}
