'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Badge,
  Checkbox,
  DeleteButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  toast,
} from '@testmaker/ui'
import { useMuzeMenit } from '@/components/Prava'

export interface GroupMaterial {
  id: string
  fileName: string
  charCount: number
  pageCount: number | null
  needsOcr: boolean
  duplicateOfId: string | null
  duplicateScore: number | null
  /** Ručně vyřazený z generování — materiál v tématu zůstává, jen se nepoužije. */
  excluded: boolean
}

/**
 * Jeden řádek materiálu v pruhu: název, rozsah textu, poznámka o duplicitě,
 * přepínač „Použít pro generování" a smazání. Přesun do jiného tématu se
 * nabízí jen v režimu „Upravit téma" — je to úprava zařazení, ne práce s
 * jedním materiálem samotným.
 */
export function MaterialRow({
  material,
  originalFileName,
  manage,
  siblings,
  optionsReady,
  busy,
  onMove,
}: {
  material: GroupMaterial
  /** Název materiálu, jehož je tenhle duplicitou — pro poznámku „stejný obsah jako …". */
  originalFileName: string | null
  manage: boolean
  siblings: { id: string; name: string }[]
  optionsReady: boolean
  busy: boolean
  onMove: (topicId: string) => void
}) {
  const router = useRouter()
  const muzeMenit = useMuzeMenit()
  const [excludePending, setExcludePending] = useState(false)
  // Optimistická změna: zaškrtnutí se projeví hned, ne až po `router.refresh()`.
  // Když server odmítne, vrátí se zpátky a učitelka se to dozví hláškou —
  // jinak by checkbox tiše zůstal v poloze, která se neuložila.
  const [excludedOverride, setExcludedOverride] = useState(material.excluded)
  useEffect(() => setExcludedOverride(material.excluded), [material.excluded])

  async function toggleExcluded() {
    const next = !excludedOverride
    setExcludedOverride(next)
    setExcludePending(true)
    try {
      const response = await fetch('/api/materials', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: material.id, excluded: next }),
      })
      if (!response.ok) {
        setExcludedOverride(!next)
        const detail = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(detail.error ?? 'Nepovedlo se to uložit, zkus to prosím znovu.')
        return
      }
      router.refresh()
    } catch (networkError) {
      setExcludedOverride(!next)
      toast.error(networkError instanceof Error ? networkError.message : 'Nepovedlo se to uložit, zkus to prosím znovu.')
    } finally {
      setExcludePending(false)
    }
  }

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-material-id={material.id}>
      {/* Názvy souborů bývají dlouhé a bez mezer, proto se musí zalomit i uprostřed slova. */}
      <span
        className={cn(
          'min-w-0 break-all',
          material.duplicateOfId || excludedOverride ? 'text-fg-muted' : 'text-fg-soft',
        )}
        title={material.fileName}
      >
        {material.fileName}
      </span>
      <span className="shrink-0 text-fg-muted">
        {material.charCount.toLocaleString('cs')} znaků
        {material.pageCount ? `, ${material.pageCount} str.` : ''}
      </span>
      {material.needsOcr ? <Badge className="shrink-0 bg-draft-bg text-draft-fg">skoro bez textu</Badge> : null}
      {material.duplicateOfId ? (
        <span className="min-w-0 break-all text-xs text-fg-muted">
          stejný obsah jako {originalFileName ?? 'jiný materiál'}
          {material.duplicateScore ? ` (shoda ${Math.round(material.duplicateScore * 100)} %)` : ''}
        </span>
      ) : null}

      {muzeMenit ? (
        <label className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
          <Checkbox
            checked={!material.duplicateOfId && !excludedOverride}
            disabled={excludePending || !!material.duplicateOfId}
            aria-label={`Použít pro generování: ${material.fileName}`}
            onCheckedChange={() => void toggleExcluded()}
          />
          Použít pro generování
        </label>
      ) : null}

      {muzeMenit && manage && (!optionsReady || siblings.length > 0) ? (
        <Select
          value="presun"
          disabled={busy || !optionsReady}
          onValueChange={(value) => value !== 'presun' && onMove(value)}
        >
          <SelectTrigger className="w-full shrink-0 sm:w-56" aria-busy={!optionsReady || undefined}>
            {optionsReady ? <SelectValue /> : <span className="text-fg-muted">Načítám témata…</span>}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="presun">Přesunout do…</SelectItem>
            {siblings.map((sibling) => (
              <SelectItem key={sibling.id} value={sibling.id}>
                {sibling.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {muzeMenit ? (
        <DeleteButton
          label="Smazat"
          title="Smazat materiál?"
          description={`Materiál „${material.fileName}" zmizí z tématu. Otázky, které z něj vznikly, zůstanou.`}
          onConfirm={async () => {
            await fetch(`/api/materials?id=${encodeURIComponent(material.id)}`, { method: 'DELETE' })
            router.refresh()
          }}
        />
      ) : null}
    </li>
  )
}
