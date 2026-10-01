import Link from 'next/link'
import { EmptyState, NavList } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import type { GradeNode } from '@/lib/library'
import { NewLibraryItem } from '@/components/LibraryItemDialogs'

/** Second column: the selected grade's topics. */
export function TopicList({
  grade,
  activeTopicId,
}: {
  grade: GradeNode | null
  activeTopicId?: string
}) {
  if (!grade) {
    // The empty state looks the same everywhere in the app — even here, where it is just a sentence.
    return (
      <EmptyState
        title={t('library:topicList.noGradeTitle')}
        hint={t('library:topicList.noGradeHint')}
      />
    )
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-1 px-2">
        <p className="ui-label min-w-0 truncate">
          {grade.name || t('library:labels.noGrade')} · {t('library:count.topics', { count: grade.topics.length })}
        </p>
        <NewLibraryItem kind="topic" parentId={grade.id} label={t('library:topicList.addTopic')} variant="ghost" />
      </div>
      <NavList
        activeId={activeTopicId}
        items={grade.topics.map((topic) => ({
          id: topic.id,
          label: topic.name,
          count: topic.questionCount,
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
