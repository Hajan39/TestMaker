import Link from 'next/link'
import { Button, EmptyState } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * The topic does not exist. Typically after it was deleted or merged and the
 * teacher goes back in the browser to an old link — the framework's generic
 * message would leave her stranded.
 */
export default function TopicNotFound() {
  return (
    <div className="p-5">
      <EmptyState
        title={t('library:topicPage.notFoundTitle')}
        hint={t('library:topicPage.notFoundHint')}
        action={
          <Link href="/?vse=1">
            <Button>{t('library:topicPage.allClasses')}</Button>
          </Link>
        }
      />
    </div>
  )
}
