import Link from 'next/link'
import { Card } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import { NewLibraryItem, RenameLibraryItem } from '@/components/LibraryItemDialogs'
import type { SubjectNode } from '@/lib/library'

/**
 * Home as a signpost to classes: subjects as sections, grades as
 * "Subject · grade" tiles leading to `/tridy/[gradeId]`. Replaces the former
 * grades sidebar — that belonged to the grade-by-grade tree; here a whole
 * class is one tile.
 */
export function ClassTiles({ tree }: { tree: SubjectNode[] }) {
  return (
    <div className="space-y-5">
      {tree.map((subject) => (
        <section key={subject.id}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="ui-label">{subject.name}</h2>
            <div className="flex items-center gap-1">
              <RenameLibraryItem kind="subject" id={subject.id} name={subject.name} iconOnly />
              <NewLibraryItem kind="grade" parentId={subject.id} iconOnly variant="ghost" />
              <DeleteFromLibrary kind="subject" id={subject.id} iconOnly />
            </div>
          </div>

          {subject.grades.length === 0 ? (
            <p className="px-1 text-sm text-fg-muted">{t('library:classTiles.noGrades')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {subject.grades.map((grade) => {
                const questionCount = grade.topics.reduce((sum, topic) => sum + topic.questionCount, 0)
                return (
                  <Link key={grade.id} href={`/tridy/${grade.id}`}>
                    <Card className="p-4 hover:border-brand">
                      <h3 className="min-w-0 flex-1 text-sm font-medium text-fg">
                        {subject.name} · {grade.name || t('library:labels.noGrade')}
                      </h3>
                      <p className="mt-1 text-sm text-fg-muted">
                        {t('library:count.topics', { count: grade.topics.length })} · {t('library:count.questions', { count: questionCount })}
                      </p>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
