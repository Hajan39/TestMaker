'use client'

import { useRouter } from 'next/navigation'
import { Badge, Button, Card, toast } from '@testmaker/ui'
import { SkolaFormular, type NastaveniSkoly } from '@/components/SkolaFormular'
import type { SkolaRadek } from '@/lib/skoly'

const PRAZDNA: NastaveniSkoly = { name: '', googleDomain: '', googleAutoJoin: false }

export function AdministraceScreen({
  skoly,
  aktualni,
  domovska,
}: {
  skoly: SkolaRadek[]
  /** Škola, ve které administrátor právě pracuje. */
  aktualni: string
  domovska: string
}) {
  const router = useRouter()

  async function poslat(method: 'POST' | 'PATCH', telo: object, hlaska: string) {
    const response = await fetch('/api/administrace/skoly', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(telo),
    })
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) {
      toast.error(data.error ?? 'Změna se nepovedla.')
      return false
    }
    toast.success(hlaska)
    router.refresh()
    return true
  }

  async function prepnout(schoolId: string) {
    const response = await fetch('/api/administrace/skola', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schoolId }),
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? 'Školu se nepodařilo přepnout.')
      return
    }
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
                <Button className="ml-auto" size="sm" variant="outline" onClick={() => void prepnout(skola.id)}>
                  Přepnout sem
                </Button>
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
