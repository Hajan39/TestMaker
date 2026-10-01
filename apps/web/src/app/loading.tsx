import { Delayed, LoadingHeading, LoadingList, LoadingTiles, ThreePane } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * Generic fallback skeleton. The home page has three columns like a topic —
 * the frame renders at once and the skeleton fills only its content, so the
 * columns stay in place after loading. Single-page screens (import,
 * management, backup, administration) have their own `loading.tsx` with
 * `PageShell`.
 */
export default function FallbackLoading() {
  return (
    <ThreePane first={<LoadingList items={8} />} second={<LoadingList items={10} />}>
      <Delayed label={t('common:status.loading')} className="space-y-5">
        <LoadingHeading stats />
        <LoadingTiles count={6} />
      </Delayed>
    </ThreePane>
  )
}
