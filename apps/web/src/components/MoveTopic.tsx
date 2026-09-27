'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from '@testmaker/ui'
import { useMuzeMenit } from '@/components/Prava'

const BEZ_ROCNIKU = 'bez-rocniku'
const PLACEHOLDER = 'presun'

function toValue(gradeName: string): string {
  return gradeName === '' ? BEZ_ROCNIKU : gradeName
}

/**
 * Přesun tématu do jiného ročníku téhož předmětu — na stránce třídy, kde se
 * témata mezi ročníky přerovnávají nejčastěji. Nabídka ročníků se dotahuje
 * až při otevření, aby se nezatěžovalo víc dotazů, než je potřeba.
 */
export function MoveTopic({ topicId, currentGradeName }: { topicId: string; currentGradeName: string }) {
  const muzeMenit = useMuzeMenit()
  const router = useRouter()
  const [grades, setGrades] = useState<{ id: string; name: string }[] | null>(null)
  const [busy, setBusy] = useState(false)

  // Hlídka až za hooky, aby se jich v každém vykreslení volal stejný počet.
  if (!muzeMenit) return null

  async function ensureLoaded() {
    if (grades !== null) return
    const response = await fetch(`/api/topics?gradesOf=${encodeURIComponent(topicId)}`)
    if (!response.ok) return
    const data = (await response.json()) as { grades: { id: string; name: string }[] }
    setGrades(data.grades)
  }

  async function move(gradeName: string) {
    setBusy(true)
    try {
      const response = await fetch('/api/topics', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: topicId, gradeName }),
      })
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(detail.error ?? 'Přesun se nepovedl, zkus to prosím znovu.')
        return
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Přesun se nepovedl, zkus to prosím znovu.')
    } finally {
      setBusy(false)
    }
  }

  const options = (grades ?? []).filter((grade) => grade.name !== currentGradeName)

  return (
    <Select
      value={PLACEHOLDER}
      disabled={busy}
      onValueChange={(value) => {
        if (value === PLACEHOLDER) return
        void move(value === BEZ_ROCNIKU ? '' : value)
      }}
      onOpenChange={(open) => {
        if (open) void ensureLoaded()
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-7 w-auto border-none bg-transparent px-1 text-xs text-fg-muted shadow-none hover:text-fg"
        aria-label="Přesunout téma do jiného ročníku"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={PLACEHOLDER}>Přesunout do…</SelectItem>
        {grades !== null && options.length === 0 ? (
          <SelectItem value="zadna" disabled>
            V předmětu není jiný ročník
          </SelectItem>
        ) : null}
        {options.map((grade) => (
          <SelectItem key={grade.id} value={toValue(grade.name)}>
            {grade.name || 'Bez ročníku'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
