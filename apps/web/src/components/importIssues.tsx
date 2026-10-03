'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * File skip reasons (`skipReason` from `@testmaker/core/extract`) translated
 * into sentences the teacher understands. Shared by the library import and
 * uploading straight into a topic, so the same text isn't written twice.
 * Unknown reason → `undefined`.
 */
export function skipLabel(reason: string): string | undefined {
  switch (reason) {
    case 'skryty':
      return t('library:importIssues.skip.hidden')
    case 'docasny':
      return t('library:importIssues.skip.temporary')
    case 'systemova-slozka':
      return t('library:importIssues.skip.systemFolder')
    case 'obrazek':
      return t('library:importIssues.skip.image')
    case 'nepodporovany':
      return t('library:importIssues.skip.unsupported')
    case 'stary-format':
      return t('library:importIssues.skip.oldFormat')
    // Extraction finished but the file was empty (`processFile` in `@testmaker/core/extract`).
    case 'prázdný text':
      return t('library:importIssues.skip.emptyText')
    default:
      return undefined
  }
}

export interface IssueItem {
  relativePath: string
  reason: string
}

/** Collapsed list of skipped or failed files, each with its reason. */
export function IssueList({
  title,
  items,
  kind,
  testId,
}: {
  title: string
  items: IssueItem[]
  kind: 'danger' | 'neutral'
  testId: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="p-5" data-testid={testId}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger data-testid="issue-list-trigger" className="flex w-full items-center justify-between text-sm font-semibold text-fg-soft">
          {title}
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto text-sm">
            {items.map((item) => (
              <li key={item.relativePath} className="flex flex-wrap gap-2" data-testid="issue-item">
                <span className="text-fg-soft">{item.relativePath}</span>
                <span className={kind === 'danger' ? 'text-danger' : 'text-fg-muted'} data-testid="issue-reason">{item.reason}</span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
