'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BusyButton, Button, Card, StatRow, pocet, toast } from '@testmaker/ui'
import {
  obnovZeZalohy,
  poctyVZaloze,
  popisTabulky,
  prectiZalohu,
  tvaryTabulky,
  type Prubeh,
  type Zaloha,
} from '@/lib/backupClient'
import { errorMessage, fetchOrOffline, readJson, responseError } from '@/lib/requestJson'

/** Co se ukazuje v řádku počtů nad stránkou; zbytek je v kartách. */
const PREHLED = ['subjects', 'topics', 'materials', 'questions', 'tests'] as const

/**
 * Záloha knihovny: stáhnout celou knihovnu do jednoho souboru a nahrát ji
 * zpátky.
 *
 * Obnova je schválně na dvě kliknutí: nejdřív se soubor jen přečte a vypíše
 * se, co v něm je, a teprve pak se něco zapisuje. Nahrát omylem cizí nebo
 * půl roku starý soubor je jediná chyba, která se tady dá udělat.
 */
export function ZalohaScreen({ pocty }: { pocty: Record<string, number> }) {
  const router = useRouter()
  const souborRef = useRef<HTMLInputElement>(null)
  const [zaloha, setZaloha] = useState<Zaloha | null>(null)
  const [nazevSouboru, setNazevSouboru] = useState<string>('')
  const [prubeh, setPrubeh] = useState<Prubeh | null>(null)
  const [obnovuji, setObnovuji] = useState(false)
  const [vysledek, setVysledek] = useState<Record<string, number> | null>(null)
  const [chyba, setChyba] = useState<string | null>(null)
  const [stahuji, setStahuji] = useState(false)

  // Obnova jde po mnoha dávkách; zavřená záložka by ji utnula v půlce.
  useEffect(() => {
    if (!obnovuji) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [obnovuji])

  /**
   * Stažení přes fetch, ne prostým odkazem: odkaz by při vypršelém přihlášení
   * nebo chybě serveru uložil jako „zálohu“ chybovou hlášku a nikdo by to
   * nepoznal, dokud by ji nepotřeboval.
   */
  async function stahnout() {
    const failure = 'Zálohu se nepodařilo stáhnout.'
    setStahuji(true)
    try {
      const response = await fetchOrOffline('/api/export', undefined, failure)
      if (!response.ok) throw responseError(response, await readJson(response), failure)
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(`${failure} Server neposlal soubor zálohy. Obnov stránku a zkus to znovu.`)
      }
      // Utržené spojení uprostřed stahování hlásí `blob()` jako TypeError — i to chytí `errorMessage`.
      const blob = await response.blob()
      const nazev =
        /filename="?([^";]+)"?/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'testmaker-zaloha.json'
      const url = URL.createObjectURL(blob)
      const odkaz = document.createElement('a')
      odkaz.href = url
      odkaz.download = nazev
      odkaz.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(errorMessage(error, failure))
    } finally {
      setStahuji(false)
    }
  }

  async function vyberSoubor(soubor: File | null) {
    setChyba(null)
    setVysledek(null)
    setZaloha(null)
    if (!soubor) return
    try {
      const prectena = prectiZalohu(await soubor.text())
      setZaloha(prectena)
      setNazevSouboru(soubor.name)
    } catch (error) {
      setChyba(errorMessage(error, 'Soubor se nepodařilo přečíst.'))
    }
  }

  async function obnov() {
    if (!zaloha) return
    setObnovuji(true)
    setChyba(null)
    let castecne = false
    try {
      const navezeno = await obnovZeZalohy(zaloha, (dalsi) => {
        if (dalsi.hotovo > 0) castecne = true
        setPrubeh(dalsi)
      })
      setVysledek(navezeno)
      setZaloha(null)
      setPrubeh(null)
      // Počty nad stránkou musí po obnově sedět; přenačte je server.
      router.refresh()
    } catch (error) {
      const hlaska = errorMessage(error, 'Obnova se nepovedla.')
      // Slučuje se podle id (`on conflict do update`), takže opakovaný běh nic nezdvojí.
      setChyba(castecne ? `${hlaska} Část se už navezla; stačí obnovu spustit znovu, nic se nezdvojí.` : hlaska)
      // Co se stihlo navézt, má sedět i v počtech nad stránkou.
      if (castecne) router.refresh()
    } finally {
      setObnovuji(false)
    }
  }

  const vZaloze = zaloha ? poctyVZaloze(zaloha) : null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="ui-page-title">Záloha</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-soft">
          Celá knihovna — předměty, témata, texty materiálů, otázky, šablony i hotové testy —
          se dá stáhnout do jednoho souboru a z něj zase nahrát zpátky. Hodí se před větším
          úklidem i při přesunu na jiný počítač.
        </p>
      </div>

      <StatRow
        items={PREHLED.map((tabulka) => ({
          value: pocty[tabulka] ?? 0,
          label: popisTabulky(tabulka),
        }))}
      />

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Stáhnout zálohu</h2>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">
            Uloží se jeden soubor JSON se vším, co v knihovně je. Fronta generování se
            nezálohuje — je to jen pracovní stav, ne obsah.
          </p>
        </div>
        <div>
          <BusyButton
            busy={stahuji}
            busyLabel="Stahuji zálohu…"
            onClick={() => void stahnout()}
            data-testid="stahnout-zalohu"
          >
            Stáhnout zálohu
          </BusyButton>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Obnovit ze zálohy</h2>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">
            Ze souboru se doplní, co v knihovně chybí, a co má stejné id, se přepíše podobou
            ze zálohy. Nic se nemaže, takže se tentýž soubor dá nahrát i dvakrát — podruhé
            se už nic nezdvojí.
          </p>
        </div>

        <input
          ref={souborRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          data-testid="zaloha-soubor"
          onChange={(event) => {
            void vyberSoubor(event.target.files?.[0] ?? null)
            // Bez vynulování by opětovný výběr téhož souboru (třeba po chybě) nic neudělal.
            event.target.value = ''
          }}
        />
        <div>
          <Button variant="outline" onClick={() => souborRef.current?.click()} disabled={obnovuji}>
            Vybrat soubor zálohy
          </Button>
        </div>

        {vZaloze ? (
          <div className="space-y-3 rounded-[var(--radius-inner)] border border-line p-3" data-testid="zaloha-potvrzeni">
            <div>
              <p className="text-sm font-medium text-fg">
                Ze souboru {nazevSouboru} se naveze:
              </p>
              <ul className="ui-numeric mt-1 grid gap-x-6 gap-y-0.5 text-sm text-fg-soft sm:grid-cols-2">
                {Object.entries(vZaloze)
                  .filter(([, count]) => count > 0)
                  .map(([tabulka, count]) => (
                    <li key={tabulka}>{pocet(count, tvaryTabulky(tabulka))}</li>
                  ))}
              </ul>
              {zaloha?.vytvoreno ? (
                <p className="mt-2 text-xs text-fg-muted">
                  Záloha pořízená {new Date(zaloha.vytvoreno).toLocaleString('cs-CZ')}.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <BusyButton busy={obnovuji} busyLabel="Obnovuji…" onClick={() => void obnov()}>
                Obnovit knihovnu
              </BusyButton>
              <Button variant="ghost" onClick={() => setZaloha(null)} disabled={obnovuji}>
                Zrušit
              </Button>
            </div>
            {prubeh ? (
              <p className="ui-numeric text-sm text-fg-muted" aria-live="polite">
                {popisTabulky(prubeh.tabulka)}: {prubeh.hotovo} z {prubeh.celkem}
              </p>
            ) : null}
          </div>
        ) : null}

        {vysledek ? (
          <div className="rounded-[var(--radius-inner)] border border-line p-3" data-testid="zaloha-hotovo">
            <p className="text-sm font-medium text-fg">Obnova proběhla. Navezlo se:</p>
            <ul className="ui-numeric mt-1 grid gap-x-6 gap-y-0.5 text-sm text-fg-soft sm:grid-cols-2">
              {Object.entries(vysledek)
                .filter(([, count]) => count > 0)
                .map(([tabulka, count]) => (
                  <li key={tabulka}>{pocet(count, tvaryTabulky(tabulka))}</li>
                ))}
            </ul>
          </div>
        ) : null}

        {chyba ? (
          <p className="text-sm text-danger" role="alert" data-testid="zaloha-chyba">
            {chyba}
          </p>
        ) : null}
      </Card>
    </div>
  )
}
