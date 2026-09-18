'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Question } from '@testmaker/core/schema'
import { Button, Card, OTAZKY, pocet, toast } from '@testmaker/ui'
import {
  DEFAULT_SETTINGS,
  GenerateSettingsForm,
  ProgressLine,
  type GenerateSettings,
} from '@/components/GenerateDialog'
import { announceGeneration } from '@/components/GenerationStatus'
import { ReviewPanel } from '@/components/ReviewPanel'
import { generateQuestionsStream } from '@/lib/generateClient'

interface MaterialSummary {
  id: string
  fileName: string
  charCount: number
  /** Vyplněné u materiálu odloženého jako duplicitní obsah — do modelu nejde. */
  duplicateOfId?: string | null
}

export function TopicWorkspace({
  topicId,
  materials,
  questions,
  listTruncated,
  listLimit,
  keptCount,
  lowContent,
  ai,
  group,
}: {
  topicId: string
  materials: MaterialSummary[]
  questions: Question[]
  /** Seznam otázek je useknutý limitem — v tématu jich je víc, než se vypisuje. */
  listTruncated: boolean
  /** Kolik otázek se nejvýš vypisuje; do hlášky o useknutém seznamu. */
  listLimit: number
  /**
   * Otázky tématu kromě zamítnutých. Po kontrole konceptů má smysl doplňovat
   * právě na počet těch, které v tématu zůstaly použitelné. Počítá se dotazem,
   * ne z vypsaného seznamu — ten je useknutý limitem.
   */
  keptCount: number
  /** Použitelného textu (bez duplicit) je málo na písemku — generování zůstává možné, jen ne jako výchozí volba. */
  lowContent: boolean
  ai: { configured: boolean; provider: string; model: string }
  /** Materiály tématu — vykreslí se mezi hlavní akcí a seznamem otázek. */
  group: React.ReactNode
}) {
  const router = useRouter()
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Kolik otázek v právě běžícím generování už vzniklo. */
  const [created, setCreated] = useState(0)
  /**
   * Otázky vytvořené v tomhle běhu. Seznam níž se obnovuje až po doběhnutí
   * (router.refresh), a čekat na to znamená deset minut koukat na kolečko —
   * tyhle se do seznamu přidají hned, jak je server uloží.
   */
  const [fresh, setFresh] = useState<Question[]>([])
  /** Dokončený běh: souhrn zůstane na obrazovce i po zmizení hlášky. */
  const [outcome, setOutcome] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Po obnovení seznamu přijdou tytéž otázky i v `questions` — podle id se
  // proto čerstvé, které už v seznamu jsou, vynechají, ať se nezdvojí.
  const shownQuestions = useMemo(() => {
    const known = new Set(questions.map((question) => question.id))
    return [...fresh.filter((question) => !known.has(question.id)), ...questions]
  }, [fresh, questions])

  // Ukazujeme jen to, co skutečně půjde do modelu: generování duplicitní
  // obsah vynechává, takže se nesmí počítat ani tady — jinak na obrazovce
  // stojí velké číslo a hned pod ním upozornění, že materiálů je málo.
  const usable = materials.filter((material) => !material.duplicateOfId)
  const topUp = settings.mode === 'target'
  const willCreate = topUp ? Math.max(0, settings.count - keptCount) : settings.count

  async function generate() {
    setError(null)
    setGenerating(true)
    setOutcome(null)
    setCreated(0)
    setFresh([])
    setStatus('Spouštím generování…')
    announceGeneration()
    abortRef.current = new AbortController()
    // Průběh se skládá ze dvou údajů: kolik otázek už je hotových (to učitelku
    // zajímá) a kde se model v materiálech nachází (to jen dokresluje, jak
    // dlouho to ještě potrvá).
    let hotovo = 0
    let cast: { done: number; total: number } | null = null
    const prubeh = () => {
      const otazky = hotovo > 0 ? `Hotovo ${pocet(hotovo, OTAZKY)}` : 'Zatím žádná otázka není hotová'
      // `done` je počet už zpracovaných částí; pracuje se tedy na následující.
      // Když je hotová i poslední, žádná další už nezbývá a nemá se co hlásit.
      const zbyva = cast && cast.done < cast.total
      setStatus(zbyva ? `${otazky} · pracuji na části ${cast!.done + 1} z ${cast!.total}` : otazky)
    }

    try {
      await generateQuestionsStream({ topicId, ...settings }, (event) => {
        if (event.type === 'progress') {
          cast = { done: event.done, total: event.total }
          prubeh()
        } else if (event.type === 'saved') {
          hotovo = event.created
          setCreated(event.created)
          // Nejnovější nahoře — stejně jako seznam otázek pod tím.
          setFresh((current) => [...event.questions.slice().reverse(), ...current])
          prubeh()
        } else if (event.type === 'done') {
          const souhrn = summarizeRun(event)
          setStatus(null)
          setOutcome(souhrn)
          toast.success(souhrn, {
            duration: 12_000,
            action: event.created > 0
              ? {
                  label: 'Zkontrolovat',
                  onClick: () => router.push(`/review?topicId=${encodeURIComponent(topicId)}`),
                }
              : undefined,
          })
          router.refresh()
        } else if (event.type === 'error') setError(event.message)
      }, abortRef.current.signal)
    } catch (streamError) {
      setError(streamError instanceof Error ? streamError.message : String(streamError))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-5">
      {ai.configured ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-fg">Generovat otázky</h2>
          {/* Obrazovka tématu začínala odstavcem o tom, co dostane model —
              poznámkou pro vývojáře. Nahoře zůstává jedna věta o tom, co z
              toho učitelce vznikne; podrobnosti čekají v nastavení. */}
          <p className="mt-1 text-sm text-fg-muted">
            Z materiálů tématu vzniknou nové otázky jako koncepty ke kontrole.
          </p>
          {keptCount > 0 ? (
            <p className="mt-1 text-sm text-fg-muted">
              {topUp
                ? willCreate > 0
                  ? `Doplní se ${willCreate} ${willCreate === 1 ? 'nová otázka' : willCreate < 5 ? 'nové otázky' : 'nových otázek'}.`
                  : 'Zvolený počet je už naplněný, nic se nevytvoří.'
                : 'Stávající otázky dostane model jako seznam, kterému se má vyhnout.'}
            </p>
          ) : null}
          {lowContent ? (
            <p className="mt-2 text-sm text-fg-muted">
              Materiálů je v tomhle tématu málo — model z nich zvládne vytvořit jen pár otázek a
              některé se budou opakovat. Spolehlivější je nejdřív přidat další materiál nebo téma
              sloučit s příbuzným. Generovat i tak jde, jen počítej s tím, že výsledek bude potřeba
              víc kontrolovat.
            </p>
          ) : null}
          <div className="mt-3">
            <GenerateSettingsForm
              value={settings}
              onChange={setSettings}
              disabled={generating}
              note={
                <p className="text-xs text-fg-muted">
                  Model {ai.model} dostane všechny materiály tématu naráz, aby se otázky
                  neopakovaly. Materiály označené jako duplicitní obsah se vynechávají.
                </p>
              }
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant={lowContent ? 'outline' : 'default'}
              disabled={generating || usable.length === 0 || willCreate === 0}
              onClick={() => void generate()}
            >
              {keptCount > 0 ? 'Dogenerovat z tématu' : 'Vygenerovat z tématu'}
            </Button>
            {generating ? <ProgressLine label={status ?? 'Spouštím generování…'} /> : null}
          </div>
          {/* Souhrn běhu zůstává na obrazovce i po zmizení hlášky — učitelka se
              k němu vrací, když se rozmýšlí, jestli má jít kontrolovat hned. */}
          {!generating && outcome ? (
            <p className="mt-3 text-sm text-fg-soft">
              {outcome}{' '}
              {created > 0 ? (
                <Link
                  href={`/review?topicId=${encodeURIComponent(topicId)}`}
                  className="text-brand underline underline-offset-2"
                >
                  Zkontrolovat nové koncepty
                </Link>
              ) : null}
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </Card>
      ) : null}

      {group}

      {listTruncated ? (
        <p className="text-sm text-fg-muted">
          Otázek je v tomhle tématu víc, než se sem vejde — vypisuje se prvních {listLimit}{' '}
          od nejnovější. Zbytek najdeš v bance otázek, kde se dá filtrovat i hledat.
        </p>
      ) : null}

      <ReviewPanel topicId={topicId} questions={shownQuestions} />
    </div>
  )
}

/**
 * Věta o tom, jak generování dopadlo: kolik otázek vzniklo, kolik se zahodilo
 * a proč. Zahozené otázky nejsou chyba učitelky — ale když jich je hodně,
 * je to jediná stopa po tom, že model nad materiálem tápe.
 */
function summarizeRun(event: {
  created: number
  rejected: number
  failedCalls: number
  sources: number
  models?: string[]
}): string {
  if (event.created === 0) {
    return 'Nevznikla ani jedna otázka. Zkus to prosím znovu, případně s menším počtem otázek.'
  }
  const parts = [`Vytvořeno ${pocet(event.created, OTAZKY)}.`]
  if (event.rejected > 0) {
    parts.push(`Zahozeno: ${pocet(event.rejected, OTAZKY)} — byly neúplné nebo si odporovaly.`)
  }
  if (event.failedCalls > 0) {
    parts.push(`${event.failedCalls}× model odpověděl něčím, co se nedalo použít.`)
  }
  // Když se v jednom tématu vystřídalo víc modelů, otázky nemusí být stejně
  // kvalitní — učitelka to má vědět dřív, než je začne číst.
  if ((event.models?.length ?? 0) > 1) parts.push('Otázky psalo víc různých modelů, kvalita se může lišit.')
  return parts.join(' ')
}
