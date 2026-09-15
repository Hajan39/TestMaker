'use client'

import Link from 'next/link'
import { Badge, Card, Tooltip, TooltipContent, TooltipTrigger } from '@testmaker/ui'

/**
 * Dlaždice tématu v přehledu ročníku. Názvy bývají dlouhé a bez mezer
 * (`prirodopis-6_pl-bezobratli-vztahy._test_2018`), proto se zkracují
 * a celé znění se ukáže při najetí myší.
 */
export function TopicTile({
  id,
  name,
  questionCount,
}: {
  id: string
  name: string
  questionCount: number
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={`/topics/${id}`} className="block">
          {/* Karta ze shadcn skládá obsah svisle, proto se směr musí přepsat. */}
          <Card className="flex flex-row items-center gap-2 p-3 hover:border-brand">
            <span className="min-w-0 flex-1 truncate text-sm text-fg-soft">{name}</span>
            {questionCount > 0 ? (
              <Badge className="shrink-0">{questionCount} ot.</Badge>
            ) : (
              <Badge variant="secondary" className="shrink-0">
                bez otázek
              </Badge>
            )}
          </Card>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-md">
        {name}
      </TooltipContent>
    </Tooltip>
  )
}
