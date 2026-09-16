import type { ReactNode } from 'react'
import { cn } from './cn'
import { Skeleton } from './ui/skeleton'

/**
 * Kostry obsahu — co se v rozhraní ukáže místo toho, aby plocha na chvíli
 * zmrzla nebo poskočila.
 *
 * Skládají se z jediného dílku `Skeleton` a z tokenů, takže fungují ve světlém
 * i tmavém režimu, aniž by o něm věděly. Tvarem kopírují to, co na jejich místo
 * přijde: kostra seznamu má tolik řádků, kolik jich bývá vidět, kostra tabulky
 * stejně vysoké řádky jako skutečná tabulka. Jde o to, aby obsah nakonec
 * naskočil na totéž místo a nic se nepřesunulo.
 *
 * Žádná z nich není klientská komponenta: používají se hlavně v `loading.tsx`
 * App Routeru, které se vykresluje na serveru.
 */

/**
 * Obal, který kostru ukáže, teprve když se čekání protáhne přes 400 ms —
 * celé zpoždění drží třída `ui-delayed` v `styles.css`, tady se jen navěsí.
 * Zároveň je to jediné místo, kde se čekání oznamuje odečítači obrazovky.
 */
export function Delayed({
  label = 'Načítám…',
  className,
  children,
}: {
  /** Co uslyší odečítač obrazovky. Kostra sama je jen obrázek ničeho. */
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div data-slot="loading" role="status" aria-live="polite" className={cn('ui-delayed', className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** Šířky řádků se střídají, aby odstavec vypadal jako text, ne jako tabulka. */
const LINE_WIDTHS = ['100%', '92%', '74%', '86%', '62%']

/** Několik řádků textu. */
export function LoadingLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-3.5" style={{ width: LINE_WIDTHS[index % LINE_WIDTHS.length] }} />
      ))}
    </div>
  )
}

/** Položky seznamu v postranním sloupci: ročníky, témata. */
export function LoadingList({ items = 7, className }: { items?: number; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {Array.from({ length: items }, (_, index) => (
        <Skeleton key={index} className="h-7 rounded-[var(--radius-inner)]" />
      ))}
    </div>
  )
}

/** Nadpis obrazovky a řádek s počty pod ním. */
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

/** Mřížka dlaždic: témata ročníku, karty ročníků. */
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

/** Tabulka s hlavičkou. Řádky mají stejnou výšku jako ty skutečné. */
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

/** Karty s náhledem stránky: šablony. */
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
 * Tištěná stránka, než se vykreslí její PDF. Poměr stran odpovídá A4, takže
 * se okolí po dokreslení náhledu nepřeskládá.
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

/** Karta s nadpisem a několika řádky — běžný blok v obsahu. */
export function LoadingCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('rounded-[var(--radius-outer)] border border-line p-4', className)}>
      <Skeleton className="h-4 w-48" />
      <LoadingLines lines={lines} className="mt-3" />
    </div>
  )
}
