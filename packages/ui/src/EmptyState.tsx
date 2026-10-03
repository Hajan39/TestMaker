import type { ReactNode } from 'react'

/** Empty state: what is missing here and what to do about it. */
export function EmptyState({
  title,
  hint,
  action,
  testId,
}: {
  title: string
  hint?: string
  action?: ReactNode
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-[var(--radius-outer)] border border-dashed border-line px-6 py-10 text-center"
    >
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}
