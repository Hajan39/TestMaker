'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  Badge,
  BusyButton,
  Button,
  Card,
  DeleteButton,
  EmptyState,
  OTAZKY,
  StatRow,
  TEMATA,
  plural,
  pocet,
  toast,
} from '@testmaker/ui'
import { drainQueue } from '@/lib/generateClient'
import type { QueueCounts, QueueJob } from '@/lib/jobs'
import { shrnutiBehu } from '@/lib/queueSummary'

/** Jak často se obrazovka ptá, jak to jde. Jen dokud se něco děje. */
const REFRESH_MS = 3000

interface QueueData {
  counts: QueueCounts
  jobs: QueueJob[]
}

/**
 * Přehled generování.
 *
 * Ptá se jen tehdy, když je na co čekat: dokud něco běží nebo čeká ve frontě,
 * obnovuje se každé tři vteřiny, a jakmile je hotovo, přestane. Vlastní
 * generování obrazovka umí i pohánět — fronta se zpracovává po jednom tématu
 * a bez otevřeného okna se nehne z místa.
 */
export function QueueScreen({
  initialJobs,
  initialCounts,
  aiConfigured,
}: {
  initialJobs: QueueJob[]
  initialCounts: QueueCounts
  aiConfigured: boolean
}) {
  const router = useRouter()
  const [data, setData] = useState<QueueData>({ counts: initialCounts, jobs: initialJobs })
  const [working, setWorking] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const stopRef = useRef(false)

  const { counts, jobs } = data
  const busy = counts.running > 0 || counts.queued > 0

  const refresh = useCallback(async () => {
    const response = await fetch('/api/jobs?vypis=1')
    if (!response.ok) return
    const next = (await response.json()) as QueueCounts & { jobs: QueueJob[] }
    setData({ counts: next, jobs: next.jobs })
  }, [])

  // Dotazovat se pořád dokola by bylo zbytečné — když nic nečeká ani neběží,
  // přehled se sám od sebe nezmění.
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [busy, refresh])

  async function run() {
    setWorking(true)
    stopRef.current = false
    let created = 0
    let done = 0
    let failed = 0
    try {
      await drainQueue(
        (step) => {
          // Poslední dotaz na prázdnou frontu žádné téma nezpracuje — počítají
          // se jen skutečné kroky, jinak by souhrn hlásil o téma víc.
          if (!step.processed) return
          done += 1
          created += step.created ?? 0
          if (step.error) failed += 1
          void refresh()
        },
        () => stopRef.current,
      )
      // Chyby jednotlivých témat se dřív zahazovaly a po sedmi spadlých
      // tématech svítilo zelené „Hotovo“. Vyznění teď určuje výsledek.
      const shrnuti = shrnutiBehu({ zpracovano: done, chyby: failed, otazky: created })
      const hlaska =
        shrnuti.ton === 'chyba' ? toast.error : shrnuti.ton === 'varovani' ? toast.warning : toast.success
      hlaska(shrnuti.text, {
        duration: 12_000,
        // Kontrola konceptů přes celou knihovnu se zrušila — schvalování je
        // teď v tématu, a po hromadném běhu jich bývá víc najednou, takže
        // odkaz vede na dlaždice všech tříd (`?vse=1` — jinak by ho úvod
        // přesměroval rovnou na naposledy otevřenou třídu), odkud se dá do
        // každého z nich doklikat.
        action: created > 0 ? { label: 'Zkontrolovat', onClick: () => router.push('/?vse=1') } : undefined,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
      await refresh()
      router.refresh()
    }
  }

  async function retry(ids?: string[]) {
    setRetrying(true)
    try {
      const response = await fetch('/api/jobs/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      })
      const result = (await response.json()) as { requeued?: number }
      const requeued = result.requeued ?? 0
      toast.success(
        requeued > 0
          ? `Zpátky do fronty: ${pocet(requeued, TEMATA)}. Spusť generování, ať se dodělají.`
          : 'Nebylo co vracet do fronty.',
      )
      await refresh()
    } finally {
      setRetrying(false)
    }
  }

  async function clear(scope: 'cekajici' | 'vse') {
    await fetch(`/api/jobs?rozsah=${scope}`, { method: 'DELETE' })
    stopRef.current = true
    await refresh()
    router.refresh()
  }

  const running = jobs.filter((job) => job.status === 'running')
  const waiting = jobs.filter((job) => job.status === 'queued')
  const failed = jobs.filter((job) => job.status === 'error')
  const finished = jobs.filter((job) => job.status === 'done')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="ui-page-title">Průběh generování</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Témata, ze kterých se právě tvoří otázky, i ta, která na řadu teprve čekají. Generuje se
          po jednom tématu.
        </p>
      </div>

      <StatRow
        items={[
          { value: counts.running, label: 'právě se tvoří' },
          { value: counts.queued, label: 'čeká na řadu' },
          { value: counts.error, label: 'nedokončeno', tone: counts.error > 0 ? 'draft' : 'default' },
          { value: counts.done, label: 'hotovo' },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        {aiConfigured && counts.queued > 0 ? (
          working ? (
            <Button variant="destructive" size="sm" onClick={() => (stopRef.current = true)}>
              Zastavit
            </Button>
          ) : (
            <Button size="sm" onClick={() => void run()}>
              Generovat čekající témata
            </Button>
          )
        ) : null}
        {working ? (
          <span className="text-sm text-fg-soft">Generuji… průběh se ukládá průběžně.</span>
        ) : null}
        {counts.error > 0 ? (
          <BusyButton
            size="sm"
            variant="outline"
            busy={retrying}
            busyLabel="Vracím do fronty…"
            onClick={() => void retry()}
          >
            Zkusit znovu vše
          </BusyButton>
        ) : null}
        {counts.queued + counts.running + counts.error > 0 ? (
          <DeleteButton
            label="Vyprázdnit frontu"
            title="Vyprázdnit frontu?"
            description="Zmizí všechna čekající i nedokončená témata. Otázky, které už vznikly, zůstávají."
            confirmLabel="Vyprázdnit"
            onConfirm={() => clear('cekajici')}
          />
        ) : null}
        {counts.done > 0 ? (
          <DeleteButton
            label="Smazat i výpis hotových"
            title="Smazat celý přehled?"
            description="Zmizí výpis toho, co se kdy generovalo. Otázky v knihovně to nijak nezmění."
            confirmLabel="Smazat přehled"
            onConfirm={() => clear('vse')}
          />
        ) : null}
      </div>

      {/* Podmínka běhu patří k tlačítku, ne jen do úvodního odstavce: odchod
          ze stránky práci zastaví a to se musí vědět před kliknutím. */}
      {aiConfigured && counts.queued > 0 ? (
        <p className="-mt-3 text-sm text-fg-muted">Běží, dokud je tahle stránka otevřená.</p>
      ) : null}

      {jobs.length === 0 ? (
        <EmptyState
          title="Nic se negeneruje"
          hint="Otázky se sem dostanou z tématu tlačítkem „Vygenerovat z tématu“ nebo hromadným generováním ve třídě."
          action={
            <Link href="/">
              <Button size="sm" variant="outline">
                Do tříd
              </Button>
            </Link>
          }
        />
      ) : null}

      {/* Počty se čtou na jediném místě — ve statistickém řádku nahoře. Sekce
          se vykreslují jen když nejsou prázdné, takže by je číslo v titulku
          jen zopakovalo; u hotových by navíc lhalo, protože se jich vypisuje
          nejvýš posledních pár. */}
      <Section title="Právě se tvoří" jobs={running} />
      <Section title="Čeká na řadu" jobs={waiting} />
      <Section
        title="Nedokončeno"
        jobs={failed}
        onRetry={(id) => void retry([id])}
        retrying={retrying}
      />
      <Section
        title={
          counts.done > finished.length ? `Hotové — posledních ${finished.length}` : 'Hotové'
        }
        jobs={finished}
      />
    </div>
  )
}

function Section({
  title,
  jobs,
  onRetry,
  retrying,
}: {
  title: string
  jobs: QueueJob[]
  onRetry?: (id: string) => void
  retrying?: boolean
}) {
  if (jobs.length === 0) return null
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <ul className="mt-2 divide-y divide-line-soft">
        {jobs.map((job) => (
          <li key={job.id} data-job-id={job.id} className="flex flex-wrap items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <Link href={`/topics/${job.topicId}`} className="text-sm font-medium text-fg hover:text-brand">
                {job.topicName}
              </Link>
              {job.place ? <p className="text-xs text-fg-muted">{job.place}</p> : null}
              {job.error ? <p className="mt-1 text-sm text-danger">{job.error}</p> : null}
            </div>
            {/* Na úzké obrazovce se pravá skupina zalomí pod název tématu
                místo toho, aby vytekla z karty — `main` vodorovné rolování
                skrývá, takže tlačítko za okrajem by bylo nedosažitelné. */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-xs text-fg-muted">{describe(job)}</span>
              <StateBadge status={job.status} />
              {onRetry ? (
                <Button size="sm" variant="outline" disabled={retrying} onClick={() => onRetry(job.id)}>
                  Zkusit znovu
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * Odznak stavu. Značková zelená patří akci, ne stavu, takže se stavy liší
 * slovem a jen nedokončené si bere výstražnou barvu konceptů — je to jediný
 * stav, se kterým musí učitelka něco udělat.
 */
function StateBadge({ status }: { status: QueueJob['status'] }) {
  if (status === 'running') {
    return (
      <Badge variant="status">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        tvoří se
      </Badge>
    )
  }
  if (status === 'queued') return <Badge variant="status">čeká</Badge>
  if (status === 'error') return <Badge className="bg-draft-bg text-draft-fg">nedokončeno</Badge>
  return <Badge variant="status">hotovo</Badge>
}

/** Co se dá o úloze říct jednou krátkou větou napravo od názvu tématu. */
function describe(job: QueueJob): string {
  if (job.status === 'running') {
    return job.startedAt ? `běží ${sinceText(job.startedAt)}` : 'začíná'
  }
  if (job.status === 'queued') {
    return job.wanted ? `${pocet(job.wanted, OTAZKY)} v plánu` : 'čeká ve frontě'
  }
  if (job.status === 'error') {
    return job.createdCount > 0 ? `stihlo vzniknout ${pocet(job.createdCount, OTAZKY)}` : 'nevznikla žádná otázka'
  }
  return pocet(job.createdCount, OTAZKY)
}

/**
 * Jak dlouho už něco trvá, česky a bez vteřin: „chvíli“, „3 minuty“, „2 hodiny“.
 * Přesnost tu nikomu nepomůže, jde o to poznat zaseknutou úlohu od čerstvé.
 */
export function sinceText(from: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(from).getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'chvíli'
  if (minutes < 60) return `${minutes} ${plural(minutes, 'minutu', 'minuty', 'minut')}`
  const hours = Math.floor(minutes / 60)
  return `${hours} ${plural(hours, 'hodinu', 'hodiny', 'hodin')}`
}
