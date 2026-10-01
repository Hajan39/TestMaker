'use client'

import { useId, useState } from 'react'
import { BusyButton, Checkbox, Input, Label } from '@testmaker/ui'

export interface NastaveniSkoly {
  name: string
  googleDomain: string
  googleAutoJoin: boolean
}

/**
 * Název, doména Google a automatické přiřazení — totéž pole ve správě
 * vlastní školy, v administraci i při zakládání nové. Ukládání řeší volající;
 * formulář jen vrátí, co je v polích.
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
    <form className="flex flex-wrap items-end gap-3" onSubmit={odeslat}>
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
      <BusyButton type="submit" busy={busy} busyLabel="Ukládám…" disabled={!nastaveni.name.trim()}>
        {tlacitko}
      </BusyButton>
    </form>
  )
}
