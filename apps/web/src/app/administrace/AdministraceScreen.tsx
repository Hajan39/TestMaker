'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, BusyButton, Card, toast } from '@testmaker/ui'
import { SkolaFormular, type NastaveniSkoly } from '@/components/SkolaFormular'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import type { SkolaRadek } from '@/lib/skoly'

const PRAZDNA: NastaveniSkoly = { name: '', googleDomain: '', googleAutoJoin: false }

export function AdministraceScreen({
  skoly,
  aktualni,
  domovska,
  pouzitiAi,
}: {
  skoly: SkolaRadek[]
  /** Škola, ve které administrátor právě pracuje. */
  aktualni: string
  domovska: string
  /** Přehled použití AI; vykresluje ho server, sem přichází hotový. */
  pouzitiAi?: ReactNode
}) {
  const router = useRouter()
  /** Škola, do které se právě přepíná — dvojí kliknutí by poslalo dva požadavky. */
  const [prepinam, setPrepinam] = useState<string | null>(null)

  async function poslat(method: 'POST' | 'PATCH', telo: object, hlaska: string) {
    try {
      await requestJson('/api/administrace/skoly', jsonBody(method, telo), 'Změna se nepovedla.')
    } catch (error) {
      toast.error(errorMessage(error, 'Změna se nepovedla.'))
      return false
    }
    toast.success(hlaska)
    router.refresh()
    return true
  }

  async function prepnout(schoolId: string) {
    setPrepinam(schoolId)
    try {
      await requestJson('/api/administrace/skola', jsonBody('POST', { schoolId }), 'Školu se nepodařilo přepnout.')
    } catch (error) {
      toast.error(errorMessage(error, 'Školu se nepodařilo přepnout.'))
      setPrepinam(null)
      return
    }
    // Tlačítko zůstane zablokované až do odchodu na úvod.
    router.push('/')
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="ui-page-title">Administrace škol</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-soft">
          Školy v TestMakeru. Účty a obsah konkrétní školy spravuješ po přepnutí do ní — v liště
          nahoře nebo tlačítkem u školy. Nová škola dostane vestavěné šablony rovnou.
        </p>
      </div>

      {pouzitiAi}

      <Card className="p-4">
        <h2 className="mb-3 font-medium text-fg">Nová škola</h2>
        <SkolaFormular
          vychozi={PRAZDNA}
          tlacitko="Založit školu"
          onUlozit={(nastaveni) => poslat('POST', nastaveni, `Škola ${nastaveni.name.trim()} založena.`)}
        />
      </Card>

      <div className="space-y-2">
        {skoly.map((skola) => (
          <Card key={skola.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium text-fg">{skola.name}</h2>
              {skola.id === domovska ? <Badge variant="secondary">domovská</Badge> : null}
              {skola.id === aktualni ? <Badge>právě tady</Badge> : null}
              <span className="ui-numeric text-xs text-fg-muted">
                {skola.slug} · účtů {skola.pocetUctu}
              </span>
              {skola.id !== aktualni ? (
                <BusyButton
                  className="ml-auto"
                  size="sm"
                  variant="outline"
                  busy={prepinam === skola.id}
                  busyLabel="Přepínám…"
                  disabled={prepinam !== null}
                  onClick={() => void prepnout(skola.id)}
                >
                  Přepnout sem
                </BusyButton>
              ) : null}
            </div>
            <SkolaFormular
              vychozi={{
                name: skola.name,
                googleDomain: skola.googleDomain ?? '',
                googleAutoJoin: skola.googleAutoJoin,
              }}
              tlacitko="Uložit"
              onUlozit={(nastaveni) => poslat('PATCH', { id: skola.id, ...nastaveni }, 'Škola uložena.')}
            />
          </Card>
        ))}
      </div>
    </div>
  )
}
