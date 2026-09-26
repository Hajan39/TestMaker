'use client'

import Link from 'next/link'
import { Badge, Card, MATERIALY, OTAZKY, Tooltip, TooltipContent, TooltipTrigger, pocet } from '@testmaker/ui'
import { InlineName } from '@/components/InlineName'

/**
 * Dlaždice tématu v přehledu ročníku. Názvy bývají dlouhé a bez mezer
 * (`prirodopis-6_pl-bezobratli-vztahy._test_2018`), proto se zkracují
 * a celé znění se ukáže při najetí myší.
 *
 * Dlaždice má tři řádky a každý má jednu úlohu:
 *
 * 1. samotný název a tužka k přejmenování — nic víc, ať jde přehled ročníku
 *    přejet očima po názvech,
 * 2. čísla: kolik má téma materiálů a otázek,
 * 3. odznaky: co v tématu vázne.
 *
 * Dřív stály odznaky vedle názvu a čísla pod nimi totéž opakovala. Název se
 * tím krátil o to dřív, čím víc se u tématu dělo.
 */
export function TopicTile({
  id,
  name,
  materialCount,
  questionCount,
  lowContent,
}: {
  id: string
  name: string
  materialCount: number
  questionCount: number
  /** Použitelného textu je málo na písemku — viz `MIN_USABLE_TOPIC_CHARS`. */
  lowContent?: boolean
}) {
  return (
    <Card className="gap-1.5 p-3 hover:border-brand">
      {/* Přejmenování patří k názvu, proto je uvnitř karty, ne vedle ní. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex min-w-0 items-center gap-1">
            <InlineName
              kind="topic"
              id={id}
              name={name}
              className="text-sm text-fg-soft"
              label="Přejmenovat téma"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-md">
          {name}
        </TooltipContent>
      </Tooltip>

      <Link href={`/topics/${id}`} className="block">
        <p className="truncate text-xs text-fg-muted">
          {pocet(materialCount, MATERIALY)}
          {questionCount > 0 ? ` · ${pocet(questionCount, OTAZKY)}` : ''}
        </p>
      </Link>

      {questionCount === 0 || lowContent ? (
        <Link href={`/topics/${id}`} className="flex flex-wrap items-center gap-1">
          {questionCount === 0 ? <Badge variant="status">bez otázek</Badge> : null}
          {lowContent ? <Badge variant="status">málo textu</Badge> : null}
        </Link>
      ) : null}
    </Card>
  )
}
