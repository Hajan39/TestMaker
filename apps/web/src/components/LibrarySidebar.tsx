import Link from 'next/link'
import { NavList } from '@testmaker/ui'
import type { SubjectNode } from '@/lib/library'

/** První sloupec: předměty jako popisky, ročníky jako položky. */
export function LibrarySidebar({
  tree,
  activeGradeId,
}: {
  tree: SubjectNode[]
  activeGradeId?: string
}) {
  return (
    <nav className="space-y-3">
      {tree.map((subject) => (
        <div key={subject.id}>
          <p className="ui-label mb-1 px-2">{subject.name}</p>
          <NavList
            activeId={activeGradeId}
            items={subject.grades.map((grade) => ({
              id: grade.id,
              label: grade.name || 'Bez ročníku',
              count: grade.topics.length,
              flag: grade.topics.some((topic) => topic.draftCount > 0),
            }))}
            renderItem={(item) => (
              <Link href={`/?grade=${item.id}`} className="block">
                {item.label}
              </Link>
            )}
          />
        </div>
      ))}
    </nav>
  )
}
