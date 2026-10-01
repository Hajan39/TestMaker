import Link from 'next/link'
import { Button, EmptyState } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * The class doesn't exist. Typically after it was deleted, when the teacher
 * goes back in the browser to an old link, or `RememberClass` still remembers
 * it — the framework's generic message would leave her stuck.
 */
export default function ClassNotFound() {
  return (
    <div className="p-5">
      <EmptyState
        title={t('library:grade.notFoundTitle')}
        hint={t('library:grade.notFoundHint')}
        action={
          <Link href="/?vse=1">
            <Button>{t('library:grade.allClasses')}</Button>
          </Link>
        }
      />
    </div>
  )
}
