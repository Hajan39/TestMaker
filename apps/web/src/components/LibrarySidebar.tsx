import Link from 'next/link'
import { NavList } from '@testmaker/ui'
import type { SubjectNode } from '@/lib/library'
import { LibrarySearch } from '@/components/LibrarySearch'
import { NewLibraryItem } from '@/components/LibraryItemDialogs'

/** První sloupec: hledání přes celou knihovnu, pak předměty jako popisky, ročníky jako položky. */
export function LibrarySidebar({
  tree,
  activeGradeId,
}: {
  tree: SubjectNode[]
  activeGradeId?: string
}) {
  return (
    <nav className="space-y-3">
      <LibrarySearch />
      {tree.map((subject) => (
        <div key={subject.id}>
          <div className="mb-1 flex items-center justify-between gap-1 px-2">
            <p className="ui-label min-w-0 truncate">{subject.name}</p>
            {/* Ročník se zakládá tam, kde jsou ročníky vidět — tedy u předmětu.
                Stačí ikona: popisek u každého předmětu by přebil jeho název. */}
            <NewLibraryItem kind="grade" parentId={subject.id} iconOnly variant="ghost" />
          </div>
          <NavList
            activeId={activeGradeId}
            items={subject.grades.map((grade) => ({
              id: grade.id,
              label: grade.name || 'Bez ročníku',
              count: grade.topics.length,
            }))}
            renderItem={(item, content, active) => (
              <Link href={`/?grade=${item.id}`} className="block" aria-current={active ? 'page' : undefined}>
                {content}
              </Link>
            )}
          />
        </div>
      ))}
      {/* Popisek by tu byl třetí „Nový…" pod sebou; ikona s popiskem při
          najetí říká totéž a nechá vyniknout názvy předmětů. */}
      <div className="px-2">
        <NewLibraryItem kind="subject" iconOnly variant="ghost" />
      </div>
    </nav>
  )
}
