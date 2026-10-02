import { FileCheck2, Shapes } from 'lucide-react'
import type { TestKind } from '@testmaker/core/schema'
import { cn } from '@testmaker/ui'

/**
 * Icon telling a worksheet from a written test at a glance. Worksheets carry
 * their own colour (`--color-worksheet`) wherever they appear, so the two
 * never get mixed up. Hidden from screen readers — the text next to it
 * already says it.
 */
export function KindMark({ kind, className }: { kind: TestKind; className?: string }) {
  const worksheet = kind === 'pracovni_list'
  const Icon = worksheet ? Shapes : FileCheck2
  return (
    // Decorative: the page title and the list already say what it is.
    <Icon
      aria-hidden
      className={cn('inline size-[1em] shrink-0', worksheet ? 'text-worksheet' : 'text-fg-muted', className)}
    />
  )
}
