import Link from 'next/link'
import { NavList } from '@testmaker/ui'
import type { SubjectNode } from '@/lib/library'
import { LibrarySearch } from '@/components/LibrarySearch'
import { NewLibraryItem } from '@/components/LibraryItemDialogs'
import { t } from '@testmaker/core/i18n'

/** First column: search across the whole library, then subjects as labels and grades as items. */
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
            {/* A grade is created where grades are visible — at the subject.
                An icon is enough: a label on every subject would drown its name. */}
            <NewLibraryItem kind="grade" parentId={subject.id} iconOnly variant="ghost" />
          </div>
          <NavList
            activeId={activeGradeId}
            items={subject.grades.map((grade) => ({
              id: grade.id,
              label: grade.name || t('library:labels.noGrade'),
              count: grade.topics.length,
            }))}
            renderItem={(item, content, active) => (
              <Link href={`/tridy/${item.id}`} className="block" aria-current={active ? 'page' : undefined}>
                {content}
              </Link>
            )}
          />
        </div>
      ))}
      {/* A label here would be the third "Nový…" in a column; an icon with a
          hover label says the same and lets the subject names stand out. */}
      <div className="px-2">
        <NewLibraryItem kind="subject" iconOnly variant="ghost" />
      </div>
    </nav>
  )
}
