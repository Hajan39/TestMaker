'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BusyButton, Button, Card, StatRow, buttonVariants, pocet } from '@testmaker/ui'
import {
  obnovZeZalohy,
  poctyVZaloze,
  popisTabulky,
  prectiZalohu,
  tvaryTabulky,
  type Prubeh,
  type Zaloha,
} from '@/lib/backupClient'

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
      setChyba(error instanceof Error ? error.message : 'Soubor se nepodařilo přečíst.')
    }
  }

  async function obnov() {
    if (!zaloha) return
    setObnovuji(true)
    setChyba(null)
    try {
      const navezeno = await obnovZeZalohy(zaloha, setPrubeh)
      setVysledek(navezeno)
      setZaloha(null)
      setPrubeh(null)
      // Počty nad stránkou musí po obnově sedět; přenačte je server.
      router.refresh()
    } catch (error) {
      setChyba(error instanceof Error ? error.message : 'Obnova se nepovedla.')
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
          <a className={buttonVariants()} href="/api/export" download data-testid="stahnout-zalohu">
            Stáhnout zálohu
          </a>
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
          onChange={(event) => void vyberSoubor(event.target.files?.[0] ?? null)}
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
