import Link from 'next/link'
import { EmptyState, NavList, TEMATA, pocet } from '@testmaker/ui'
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
    // Prázdný stav vypadá všude v aplikaci stejně — i tady, kde je jen věta.
    return (
      <EmptyState
        title="Zatím není vybraný ročník"
        hint="Vyber ročník v levém sloupci a objeví se tu jeho témata."
      />
    )
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-1 px-2">
        <p className="ui-label min-w-0 truncate">
          {grade.name || 'Bez ročníku'} · {pocet(grade.topics.length, TEMATA)}
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
