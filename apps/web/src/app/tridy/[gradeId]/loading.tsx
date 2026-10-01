import { Delayed, LoadingHeading, LoadingList } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * Transition to the class page: a "Subject · grade" heading with stats and a
 * list of topics below — mirrors `ClassTopics`, not the tile grid (that one
 * belongs to the home page).
 */
export default function ClassLoading() {
  return (
    <Delayed label={t('library:grade.loading')} className="space-y-5">
      <LoadingHeading stats />
      <LoadingList items={8} />
    </Delayed>
  )
}
