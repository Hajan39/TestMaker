import { Delayed, LoadingCard, PageShell, Skeleton } from '@testmaker/ui'

/**
 * Kostra skládání testu — společná pro nový i otevřený test. Načítá se celá
 * banka otázek napříč tématy, takže je to jeden z nejdelších přechodů.
 *
 * Tvar kopíruje rozvržení skládání: lišta s názvem a akcemi, pod ní sloupce
 * (banka a stránka písemky) vysoké jako ty skutečné, aby stránka po načtení
 * nepodskočila.
 */
export function BuilderLoading({ label }: { label: string }) {
  return (
    <PageShell>
      <Delayed label={label} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-8 w-64" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
        <div className="grid h-[70vh] grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
          <LoadingCard lines={9} className="min-h-0" />
          <LoadingCard lines={7} className="min-h-0" />
        </div>
      </Delayed>
    </PageShell>
  )
}
