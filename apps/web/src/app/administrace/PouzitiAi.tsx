import Link from 'next/link'
import { Badge, Button, Card, EmptyState } from '@testmaker/ui'
import { OBDOBI_DNI, type PrehledPouzitiAi, type UlohaAi } from '@/lib/aiUsage'

const ULOHY: Record<UlohaAi, string> = {
  otazky: 'Otázky',
  hlavolam: 'Hlavolamy',
  list: 'Pracovní listy',
}

const cislo = (hodnota: number) => hodnota.toLocaleString('cs-CZ')
const datum = (iso: string) =>
  new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

function Tabulka({ hlavicka, radky }: { hlavicka: string[]; radky: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line-soft text-fg-muted">
            {hlavicka.map((nazev, i) => (
              <th key={nazev} className={`py-2 pr-4 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {nazev}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {radky.map((radek) => (
            <tr key={String(radek[0])}>
              {radek.map((bunka, i) => (
                <td key={i} className={`py-2 pr-4 ${i > 0 ? 'ui-numeric text-right' : 'text-fg'}`}>
                  {typeof bunka === 'number' ? cislo(bunka) : bunka}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Přehled použití AI pro administrátora: jak je nastavený žebříček modelů
 * a co se za období opravdu volalo. Jen ke čtení — nastavení zůstává
 * v `AI_MODELS`. Období se přepíná odkazem (`?dni=`), takže stránka zůstává
 * serverová a nic se nedotahuje z prohlížeče.
 */
export function PouzitiAi({ prehled }: { prehled: PrehledPouzitiAi }) {
  const nejvic = Math.max(1, ...prehled.dny.map((den) => den.ok + den.limit + den.ostatni))

  return (
    <Card className="space-y-5 p-4" aria-labelledby="pouziti-ai">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="pouziti-ai" className="font-medium text-fg">
          Použití AI
        </h2>
        <nav className="ml-auto flex gap-1" aria-label="Období">
          {OBDOBI_DNI.map((dni) => (
            <Button key={dni} asChild size="sm" variant={dni === prehled.dni ? 'default' : 'outline'}>
              <Link href={`?dni=${dni}`} aria-current={dni === prehled.dni ? 'page' : undefined}>
                {dni} dní
              </Link>
            </Button>
          ))}
        </nav>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-soft">Žebříček modelů</h3>
        {prehled.zebricek.length === 0 ? (
          <p className="text-sm text-fg-muted">V AI_MODELS není žádný model — generování je vypnuté.</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {prehled.zebricek.map((polozka, i) => (
              <li key={polozka.model} className="flex flex-wrap items-center gap-2">
                <span className="ui-numeric w-5 text-fg-muted">{i + 1}.</span>
                <span className={polozka.maKlic ? 'text-fg' : 'text-fg-muted line-through'}>{polozka.model}</span>
                {polozka.maKlic ? null : <Badge variant="secondary">přeskakuje se, chybí klíč</Badge>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {prehled.celkem === 0 ? (
        <EmptyState
          title="Zatím se nic negenerovalo."
          hint="Záznamy se sbírají od nasazení této verze."
        />
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-fg-soft">Podle modelu</h3>
            <Tabulka
              hlavicka={['Model', 'Volání', 'Úspěšná', 'Limit', 'Nepoužitelná', 'Chyba', 'Tokeny vstup', 'Tokeny výstup', 'Naposledy']}
              radky={prehled.modely.map((m) => [
                m.model,
                m.volani,
                m.ok,
                m.limit,
                m.badShape,
                m.error,
                m.vstup,
                m.vystup,
                datum(m.naposledy),
              ])}
            />
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-fg-soft">Podle úlohy</h3>
              <Tabulka
                hlavicka={['Úloha', 'Volání', 'Tokeny vstup', 'Tokeny výstup']}
                radky={prehled.ulohy.map((u) => [ULOHY[u.task], u.volani, u.vstup, u.vystup])}
              />
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-fg-soft">Podle školy</h3>
              <Tabulka
                hlavicka={['Škola', 'Volání', 'Tokeny vstup', 'Tokeny výstup']}
                radky={prehled.skoly.map((s) => [s.nazev, s.volani, s.vstup, s.vystup])}
              />
            </section>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-medium text-fg-soft">Po dnech</h3>
            <div className="flex h-24 items-end gap-px" role="img" aria-label={`Počet volání po dnech za ${prehled.dni} dní`}>
              {prehled.dny.map((den) => {
                const celkem = den.ok + den.limit + den.ostatni
                return (
                  <div
                    key={den.den}
                    className="flex h-full min-w-0 flex-1 flex-col-reverse"
                    title={`${den.den}: ${celkem} volání (úspěšná ${den.ok}, limit ${den.limit}, ostatní ${den.ostatni})`}
                  >
                    <div className="bg-brand" style={{ height: `${(den.ok / nejvic) * 100}%` }} />
                    <div className="bg-draft-fg" style={{ height: `${(den.limit / nejvic) * 100}%` }} />
                    <div className="bg-fg-muted" style={{ height: `${(den.ostatni / nejvic) * 100}%` }} />
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-fg-muted">
              <span className="flex items-center gap-1">
                <span className="size-2.5 bg-brand" /> úspěšná
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2.5 bg-draft-fg" /> narazila na limit
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2.5 bg-fg-muted" /> nepoužitelná odpověď nebo chyba
              </span>
            </div>
          </section>
        </>
      )}
    </Card>
  )
}
