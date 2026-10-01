'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, X } from 'lucide-react'
import { Button, Input, cn } from '@testmaker/ui'
import { useMuzeMenit } from '@/components/Prava'
import type { LibraryKind } from '@/lib/library'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'

/**
 * Přejmenování na místě: název se při kliknutí na tužku promění v pole.
 *
 * Dialog by tu byl zbytečný obřad — jde o jedno slovo a jeho nová podoba
 * patří přesně tam, kde ten název stojí. Ukládá se klávesou Enter, ruší
 * Escapem; chyba ze serveru (třeba dvě témata téhož jména) se ukáže pod polem.
 */
export function InlineName({
  kind,
  id,
  name,
  as: NameTag = 'span',
  className,
  inputClassName,
  label,
}: {
  kind: LibraryKind
  id: string
  name: string
  /**
   * Čím se vykreslí samotný název. Nadpis stránky musí zůstat nadpisem a nesmí
   * do svého názvu pobrat popisek tlačítka vedle sebe, proto je tlačítko vždy
   * až za ním, ne uvnitř.
   */
  as?: 'span' | 'h1' | 'h2'
  /** Třídy pro text názvu, aby šlo použít jak v nadpisu, tak v dlaždici. */
  className?: string
  inputClassName?: string
  /** Popisek tlačítka pro čtečky obrazovky. */
  label?: string
}) {
  const router = useRouter()
  const muzeMenit = useMuzeMenit()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Po zapnutí úprav patří pozornost do pole, jinak musí učitelka klikat dvakrát.
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  async function save() {
    const next = value.trim()
    if (!next || next === name) {
      setEditing(false)
      setValue(name)
      return
    }

    setBusy(true)
    setError(null)
    try {
      await requestJson('/api/library', jsonBody('PATCH', { kind, id, name: next }), 'Přejmenování se nepovedlo.')
      setEditing(false)
      router.refresh()
    } catch (saveError) {
      setError(errorMessage(saveError, 'Přejmenování se nepovedlo.'))
    } finally {
      setBusy(false)
    }
  }

  // Náhled jen čte — bez tužky, ať z rozhraní hned poznat, že se přejmenovat
  // nedá, ne až z odmítnutého požadavku.
  if (!muzeMenit) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <NameTag className={cn('min-w-0 flex-1 truncate', className)}>{name}</NameTag>
      </span>
    )
  }

  if (!editing) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <NameTag className={cn('min-w-0 flex-1 truncate', className)}>{name}</NameTag>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          aria-label={label ?? `Přejmenovat: ${name}`}
          title={label ?? 'Přejmenovat'}
          onClick={(event) => {
            // Dlaždice bývá odkaz; tužka nemá nikam odnavigovat.
            event.preventDefault()
            event.stopPropagation()
            // Pole se plní až tady, ne v efektu: stav měněný během vykreslení
            // vede na řetězení překreslení a React na to upozorňuje.
            setValue(name)
            setEditing(true)
          }}
        >
          <Pencil aria-hidden />
        </Button>
      </span>
    )
  }

  return (
    <span
      className="flex min-w-0 flex-1 flex-col gap-1"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <span className="flex min-w-0 items-center gap-1">
        <Input
          ref={inputRef}
          value={value}
          disabled={busy}
          aria-label={label ?? 'Nový název'}
          aria-invalid={error ? true : undefined}
          className={cn('h-8 min-w-0 flex-1', inputClassName)}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
            if (event.key === 'Escape') {
              setEditing(false)
              setValue(name)
              setError(null)
            }
          }}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label="Uložit název"
          title="Uložit"
          onClick={() => void save()}
        >
          <Check aria-hidden />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label="Zrušit přejmenování"
          title="Zrušit"
          onClick={() => {
            setEditing(false)
            setValue(name)
            setError(null)
          }}
        >
          <X aria-hidden />
        </Button>
      </span>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  )
}
