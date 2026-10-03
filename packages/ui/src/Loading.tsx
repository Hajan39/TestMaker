import type { ReactNode } from 'react'
import { t } from '@testmaker/core/i18n'
import { cn } from './cn'
import { Skeleton } from './ui/skeleton'

/**
 * Content skeletons — what the UI shows instead of freezing or jumping for a
 * moment.
 *
 * They are built from the single `Skeleton` piece and tokens, so they work in
 * light and dark mode without knowing about it. Their shape copies what will
 * replace them: a list skeleton has as many rows as are usually visible, a table
 * skeleton has rows as tall as the real table. The point is that the content
 * lands in the same place and nothing shifts.
 *
 * None of them is a client component: they are used mainly in App Router
 * `loading.tsx` files, which render on the server.
 */

/**
 * Wrapper that shows the skeleton only once the wait exceeds 400 ms — the whole
 * delay lives in the `ui-delayed` class in `styles.css`, it is only attached
 * here. It is also the only place where waiting is announced to screen readers.
 */
export function Delayed({
  label,
  className,
  testId,
  children,
}: {
  /** What the screen reader hears. The skeleton itself is a picture of nothing. */
  label?: string
  className?: string
  testId?: string
  children: ReactNode
}) {
  return (
    <div data-slot="loading" data-testid={testId} role="status" aria-live="polite" className={cn('ui-delayed', className)}>
      <span className="sr-only">{label ?? t('status.loading')}</span>
      {children}
    </div>
  )
}

/** Line widths alternate so a paragraph looks like text, not a table. */
const LINE_WIDTHS = ['100%', '92%', '74%', '86%', '62%']

/** A few lines of text. */
export function LoadingLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-3.5" style={{ width: LINE_WIDTHS[index % LINE_WIDTHS.length] }} />
      ))}
    </div>
  )
}

/** Sidebar list items: grades, topics. */
export function LoadingList({ items = 7, className }: { items?: number; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {Array.from({ length: items }, (_, index) => (
        <Skeleton key={index} className="h-7 rounded-[var(--radius-inner)]" />
      ))}
    </div>
  )
}

/** Screen heading and the stats row below it. */
export function LoadingHeading({ stats = false }: { stats?: boolean }) {
  return (
    <div>
      <Skeleton className="h-5 w-56" />
      <Skeleton className="mt-2 h-3.5 w-72" />
      {stats ? (
        <div className="mt-4 flex gap-6 border-y border-line-soft py-2.5">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index}>
              <Skeleton className="h-4 w-8" />
              <Skeleton className="mt-1 h-2.5 w-16" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Tile grid: a grade's topics, grade cards. */
export function LoadingTiles({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-[var(--radius-outer)] border border-line p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-14 rounded-[var(--radius-tag)]" />
          </div>
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/** Table with a header. Rows are as tall as the real ones. */
export function LoadingTable({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div className={cn('rounded-[var(--radius-outer)] border border-line p-4', className)}>
      <div
        className="grid gap-4 border-b border-line-soft pb-2"
        style={{ gridTemplateColumns: `2fr repeat(${Math.max(1, columns - 1)}, 1fr)` }}
      >
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 w-20" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="grid items-center gap-4 border-b border-line-soft py-3 last:border-b-0"
          style={{ gridTemplateColumns: `2fr repeat(${Math.max(1, columns - 1)}, 1fr)` }}
        >
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className={cn('h-3.5', column === 0 ? 'w-full' : 'w-12')} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Cards with a page preview: templates. */
export function LoadingCards({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3', className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-[var(--radius-outer)] border border-line">
          <LoadingPaper className="border-0 border-b border-line" />
          <div className="p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * A printed page before its PDF renders. The aspect ratio matches A4, so the
 * surroundings do not reflow once the preview is drawn.
 */
export function LoadingPaper({ className }: { className?: string }) {
  return (
    <div className={cn('aspect-[210/297] w-full bg-paper p-[8%]', className)}>
      <Skeleton className="h-[3%] w-1/2" />
      <Skeleton className="mt-[3%] h-[2%] w-1/3" />
      <div className="mt-[8%] space-y-[3%]">
        {LINE_WIDTHS.concat(LINE_WIDTHS).map((width, index) => (
          <Skeleton key={index} className="h-[2%]" style={{ width }} />
        ))}
      </div>
    </div>
  )
}

/** Card with a heading and a few lines — a common content block. */
export function LoadingCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('rounded-[var(--radius-outer)] border border-line p-4', className)}>
      <Skeleton className="h-4 w-48" />
      <LoadingLines lines={lines} className="mt-3" />
    </div>
  )
}
