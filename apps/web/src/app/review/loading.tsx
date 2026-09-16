import { LoadingCard, LoadingHeading, PageShell } from '@testmaker/ui'

export default function Loading() {
  return (
    <PageShell>
      <div className="space-y-4">
        <LoadingHeading />
        <LoadingCard />
      </div>
    </PageShell>
  )
}
