import { Delayed, LoadingCard, PageShell, Skeleton } from '@testmaker/ui'

/**
 * Test builder skeleton — shared by a new and an opened test. It loads the
 * whole question bank across topics, so it is one of the longest transitions.
 *
 * The shape copies the builder layout: a bar with the title and actions, below
 * it columns (bank and test page) as tall as the real ones so the page does
 * not jump after loading.
 */
export function BuilderLoading({ label }: { label: string }) {
  return (
    <PageShell>
      <Delayed label={label} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-8 w-64" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
        <div className="grid h-[70vh] grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
          <LoadingCard lines={9} className="min-h-0" />
          <LoadingCard lines={7} className="min-h-0" />
        </div>
      </Delayed>
    </PageShell>
  )
}
