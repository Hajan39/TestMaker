'use client'

import { useId, useState } from 'react'
import { Button, Checkbox, Input, Label } from '@testmaker/ui'
import { UDAJE_SKOLY, type UdajeSkoly } from '@/lib/skolaUdaje'

export type NastaveniSkoly = {
  name: string
  googleDomain: string
  googleAutoJoin: boolean
} & UdajeSkoly

/**
 * Název, doména Google, automatické přiřazení a pod nimi adresa a kontakty —
 * totéž pole ve správě vlastní školy, v administraci i při zakládání nové.
 * Ukládání řeší volající; formulář jen vrátí, co je v polích.
 */
export function SkolaFormular({
  vychozi,
  tlacitko,
  onUlozit,
}: {
  vychozi: NastaveniSkoly
  tlacitko: string
  /** Vrací `true`, když se uložilo — formulář pro novou školu se pak vyprázdní. */
  onUlozit: (nastaveni: NastaveniSkoly) => Promise<boolean>
}) {
  const id = useId()
  const [nastaveni, setNastaveni] = useState(vychozi)
  const [busy, setBusy] = useState(false)

  async function odeslat(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      if ((await onUlozit(nastaveni)) && !vychozi.name) setNastaveni(vychozi)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={odeslat}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Label htmlFor={`${id}-nazev`}>Název školy</Label>
          <Input
            id={`${id}-nazev`}
            value={nastaveni.name}
            onChange={(event) => setNastaveni({ ...nastaveni, name: event.target.value })}
          />
        </div>
        <div className="w-56">
          <Label htmlFor={`${id}-domena`}>Doména Google</Label>
          <Input
            id={`${id}-domena`}
            placeholder="skola.cz"
            value={nastaveni.googleDomain}
            onChange={(event) => setNastaveni({ ...nastaveni, googleDomain: event.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-fg">
          <Checkbox
            checked={nastaveni.googleAutoJoin}
            onCheckedChange={(checked) => setNastaveni({ ...nastaveni, googleAutoJoin: checked === true })}
          />
          Nové účty z domény zaevidovat ke schválení
        </label>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="ui-label mb-2">Adresa a kontakty</legend>
        {UDAJE_SKOLY.map((pole) => (
          <div key={pole.klic}>
            <Label htmlFor={`${id}-${pole.klic}`}>{pole.popisek}</Label>
            <Input
              id={`${id}-${pole.klic}`}
              placeholder={pole.placeholder}
              value={nastaveni[pole.klic]}
              onChange={(event) => setNastaveni({ ...nastaveni, [pole.klic]: event.target.value })}
            />
          </div>
        ))}
      </fieldset>

      <Button type="submit" disabled={busy || !nastaveni.name.trim()}>
        {tlacitko}
      </Button>
    </form>
  )
}
