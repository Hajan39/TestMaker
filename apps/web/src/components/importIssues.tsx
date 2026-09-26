'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from '@testmaker/ui'

/**
 * Důvody přeskočení souboru (`skipReason` z `@testmaker/core/extract`)
 * přeložené do vět srozumitelných učitelce. Sdílené mezi importem knihovny
 * a nahráváním rovnou do tématu, ať se stejný text nepíše na dvou místech.
 */
export const SKIP_LABELS: Record<string, string> = {
  skryty: 'skrytý soubor',
  docasny: 'dočasný soubor',
  'systemova-slozka': 'systémová složka',
  obrazek: 'obrázek (zatím nepodporován)',
  nepodporovany: 'nepodporovaná přípona',
  'stary-format': 'starý formát – převeď na .docx / .odp',
  // Extrakce doběhla, ale soubor byl prázdný (`processFile` v `@testmaker/core/extract`).
  'prázdný text': 'soubor neobsahuje žádný text',
}

export interface IssueItem {
  relativePath: string
  reason: string
}

/** Sbalený seznam přeskočených nebo nepovedených souborů s důvodem u každého. */
export function IssueList({
  title,
  items,
  kind,
}: {
  title: string
  items: IssueItem[]
  kind: 'danger' | 'neutral'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="p-5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold text-fg-soft">
          {title}
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto text-sm">
            {items.map((item) => (
              <li key={item.relativePath} className="flex flex-wrap gap-2">
                <span className="text-fg-soft">{item.relativePath}</span>
                <span className={kind === 'danger' ? 'text-danger' : 'text-fg-muted'}>{item.reason}</span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
