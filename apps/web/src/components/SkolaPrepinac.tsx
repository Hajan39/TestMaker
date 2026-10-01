'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, School } from 'lucide-react'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@testmaker/ui'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'

/**
 * Přepínač škol pro administrátora. Název školy je v liště vidět pořád, aby
 * nikdo omylem nepracoval v cizí škole v domnění, že je doma — proto u cizí
 * svítí štítek.
 */
export function SkolaPrepinac({
  skola,
  domovskaSkolaId,
  skoly,
}: {
  skola: { id: string; name: string }
  domovskaSkolaId: string
  skoly: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const cizi = skola.id !== domovskaSkolaId

  async function prepnout(schoolId: string) {
    if (schoolId === skola.id) return
    setBusy(true)
    try {
      await requestJson('/api/administrace/skola', jsonBody('POST', { schoolId }), 'Školu se nepodařilo přepnout.')
      // Otevřené téma nebo písemka v druhé škole neexistuje — začíná se od úvodu.
      router.push('/')
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, 'Školu se nepodařilo přepnout.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" disabled={busy} aria-label={`Škola: ${skola.name}`}>
          <School className="size-4" />
          <span className="max-w-40 truncate">{skola.name}</span>
          {cizi ? <Badge variant="secondary">Cizí škola</Badge> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-fg-muted">Pracovat ve škole</DropdownMenuLabel>
        {skoly.map((moznost) => (
          <DropdownMenuItem key={moznost.id} onSelect={() => void prepnout(moznost.id)}>
            <Check className={moznost.id === skola.id ? 'size-4' : 'size-4 opacity-0'} />
            <span className="truncate">{moznost.name}</span>
            {moznost.id === domovskaSkolaId ? (
              <span className="ml-auto text-xs text-fg-muted">domovská</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/administrace')}>Administrace škol</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
