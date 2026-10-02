import Link from 'next/link'
import { EmptyState } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { BulkGenerate } from '@/components/BulkGenerate'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import { NewLibraryItem, RenameLibraryItem } from '@/components/LibraryItemDialogs'
import { SortableTopics } from '@/components/SortableTopics'
import type { ClassInfo } from '@/lib/library'

/**
 * Class page content: heading (subject and renamable grade), topics with
 * counts and generation state, adding a topic, bulk generation for the whole
 * class and deleting the grade. The "Všechny třídy" link goes back home
 * without redirecting to the last opened class.
 */
export function ClassTopics({
  classInfo,
  ai,
}: {
  classInfo: ClassInfo
  ai: { configured: boolean; provider: string; model: string }
}) {
  const questionCount = classInfo.topics.reduce((sum, topic) => sum + topic.questionCount, 0)

  return (
    <div className="space-y-5">
      <Link href="/?vse=1" className="text-sm text-fg-muted hover:text-brand">
        ← {t('library:grade.allClasses')}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-fg-muted">{classInfo.subjectName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <h1 className="ui-page-title">{classInfo.gradeName || t('library:labels.noGrade')}</h1>
            <RenameLibraryItem kind="grade" id={classInfo.gradeId} name={classInfo.gradeName} iconOnly />
          </div>
          <p className="mt-1 text-sm text-fg-soft">
            {t('library:count.topics', { count: classInfo.topics.length })} · {t('library:count.questions', { count: questionCount })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BulkGenerate
            ai={ai}
            scopes={[{ label: t('library:classTopics.generateForClass'), gradeId: classInfo.gradeId }]}
          />
          <NewLibraryItem kind="topic" parentId={classInfo.gradeId} label={t('library:classTopics.addTopic')} />
          <DeleteFromLibrary kind="grade" id={classInfo.gradeId} redirectTo="/" />
        </div>
      </div>

      {classInfo.topics.length === 0 ? (
        <EmptyState
          title={t('library:classTopics.emptyTitle')}
          hint={t('library:classTopics.emptyHint')}
        />
      ) : (
        <SortableTopics
          gradeId={classInfo.gradeId}
          gradeName={classInfo.gradeName}
          topics={classInfo.topics}
          manualOrder={classInfo.manualOrder}
        />
      )}
    </div>
  )
}
