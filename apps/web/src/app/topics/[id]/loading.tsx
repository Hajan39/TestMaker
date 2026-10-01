import { Delayed, LoadingCard, LoadingHeading } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * Navigation to a topic detail. The grade and topic columns are held by the
 * layout above this file, so only the content area repaints — clicking a topic
 * in the list does not light up a skeleton over the whole screen.
 */
export default function TopicLoading() {
  return (
    <Delayed label={t('library:topicPage.loading')} className="space-y-5">
      <LoadingHeading stats />
      <LoadingCard lines={3} />
      <LoadingCard lines={4} />
    </Delayed>
  )
}
