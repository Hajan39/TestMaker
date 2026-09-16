import Link from 'next/link'
import { NavList } from '@testmaker/ui'
import type { GradeNode } from '@/lib/library'
import { NewLibraryItem } from '@/components/LibraryItemDialogs'

/** Druhý sloupec: témata zvoleného ročníku. */
export function TopicList({
  grade,
  activeTopicId,
}: {
  grade: GradeNode | null
  activeTopicId?: string
}) {
  if (!grade) {
    return <p className="px-2 text-sm text-fg-muted">Vyber ročník vlevo.</p>
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-1 px-2">
        <p className="ui-label min-w-0 truncate">
          {grade.name || 'Bez ročníku'} · {grade.topics.length} témat
        </p>
        <NewLibraryItem kind="topic" parentId={grade.id} label="+ téma" variant="ghost" />
      </div>
      <NavList
        activeId={activeTopicId}
        items={grade.topics.map((topic) => ({
          id: topic.id,
          label: topic.name,
          count: topic.questionCount,
          flag: topic.draftCount > 0,
        }))}
        renderItem={(item, content, active) => (
          <Link href={`/topics/${item.id}`} className="block" aria-current={active ? 'page' : undefined}>
            {content}
          </Link>
        )}
      />
    </div>
  )
}
