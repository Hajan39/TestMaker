'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from '@testmaker/ui'
import { useMuzeMenit } from '@/components/Prava'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'

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
    try {
      const data = await requestJson<{ grades: { id: string; name: string }[] }>(
        `/api/topics?gradesOf=${encodeURIComponent(topicId)}`,
        undefined,
        'Ročníky se nepodařilo načíst.',
      )
      setGrades(data.grades ?? [])
    } catch (error) {
      toast.error(errorMessage(error, 'Ročníky se nepodařilo načíst.'))
    }
  }

  async function move(gradeName: string) {
    setBusy(true)
    try {
      await requestJson('/api/topics', jsonBody('PATCH', { id: topicId, gradeName }), 'Přesun se nepovedl.')
      toast.success(`Téma přesunuto do ${gradeName || 'Bez ročníku'}`)
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, 'Přesun se nepovedl, zkus to prosím znovu.'))
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
