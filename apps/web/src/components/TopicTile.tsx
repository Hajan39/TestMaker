'use client'

import Link from 'next/link'
import { Badge, Card, Tooltip, TooltipContent, TooltipTrigger } from '@testmaker/ui'

/**
 * Dlaždice tématu v přehledu ročníku. Názvy bývají dlouhé a bez mezer
 * (`prirodopis-6_pl-bezobratli-vztahy._test_2018`), proto se zkracují
 * a celé znění se ukáže při najetí myší.
 *
 * Dlaždice má dva řádky: na prvním samotný název, na druhém stav tématu —
 * kolik má materiálů a jak daleko je kontrola otázek. Bez druhého řádku se
 * z přehledu nedalo poznat, kde ještě čeká práce, a musel se otevřít.
 */
export function TopicTile({
  id,
  name,
  materialCount,
  questionCount,
  approvedCount,
  lowContent,
}: {
  id: string
  name: string
  materialCount: number
  questionCount: number
  approvedCount: number
  /** Použitelného textu je málo na písemku — viz `MIN_USABLE_TOPIC_CHARS`. */
  lowContent?: boolean
}) {
  const pendingCount = questionCount - approvedCount

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={`/topics/${id}`} className="block">
          {/* Karta ze shadcn skládá obsah svisle, tady to tak i chceme:
              nahoře název s odznakem, pod ním řádek se stavem. */}
          <Card className="gap-1 p-3 hover:border-brand">
            <div className="flex flex-row items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-fg-soft">{name}</span>
              {questionCount > 0 ? (
                <Badge className="shrink-0">{questionCount} ot.</Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  bez otázek
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-fg-muted">
              {formatMaterials(materialCount)}
              {questionCount > 0
                ? pendingCount > 0
                  ? ` · ${approvedCount} schváleno, ${pendingCount} ke kontrole`
                  : ` · vše schváleno`
                : ''}
              {lowContent ? ' · málo textu na otázky' : ''}
            </p>
          </Card>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-md">
        {name}
      </TooltipContent>
    </Tooltip>
  )
}

function formatMaterials(count: number): string {
  if (count === 0) return 'bez materiálů'
  if (count === 1) return '1 materiál'
  if (count < 5) return `${count} materiály`
  return `${count} materiálů`
}
