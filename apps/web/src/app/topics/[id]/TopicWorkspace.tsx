'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question } from '@testmaker/core/schema'
import { Button, Card, OTAZKY, plural, pocet, toast } from '@testmaker/ui'
import {
  AiUnavailable,
  DEFAULT_SETTINGS,
  GenerateSettingsForm,
  ProgressLine,
  type GenerateSettings,
} from '@/components/GenerateDialog'
import { announceGeneration } from '@/components/GenerationStatus'
import { ClaudeCodeImport } from '@/components/ClaudeCodeImport'
import { TopicQuestions, type TestUsage } from '@/components/TopicQuestions'
import { generateQuestionsStream } from '@/lib/generateClient'
import { useMuzeMenit } from '@/components/Prava'

interface MaterialSummary {
  id: string
  fileName: string
  charCount: number
  /** Vyplněné u materiálu odloženého jako duplicitní obsah — do modelu nejde. */
  duplicateOfId?: string | null
}

export function TopicWorkspace({
  topic,
  defaultTemplateId,
  materials,
  questions,
  usage,
  listTruncated,
  listLimit,
  usableCount,
  lowContent,
  ai,
  group,
}: {
  /** Metadata tématu potřebná k založení testu rovnou z výběru otázek. */
  topic: { id: string; name: string; subjectName: string; gradeId: string; gradeName: string }
  /** Výchozí šablona nové písemky (stejná volba jako u testu z prázdna). */
  defaultTemplateId: string
  materials: MaterialSummary[]
  questions: Question[]
  /** Testy, ve kterých už otázky jsou — jen ty, na které je volající vidí. */
  usage: Record<string, TestUsage[]>
  /** Seznam otázek je useknutý limitem — v tématu jich je víc, než se vypisuje. */
  listTruncated: boolean
  /** Kolik otázek se nejvýš vypisuje; do hlášky o useknutém seznamu. */
  listLimit: number
  /**
   * Otázky tématu kromě smazaných. Dogenerování doplňuje právě na tenhle
   * počet, ne na délku seznamu — ten je useknutý limitem.
   */
  usableCount: number
  /** Použitelného textu (bez duplicit) je málo na písemku — generování zůstává možné, jen ne jako výchozí volba. */
  lowContent: boolean
  ai: { configured: boolean; provider: string; model: string; problems: string[] }
  /** Materiály tématu — vykreslí se mezi hlavní akcí a seznamem otázek. */
  group: React.ReactNode
}) {
  const muzeMenit = useMuzeMenit()
  const router = useRouter()
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
  const willCreate = topUp ? Math.max(0, settings.count - usableCount) : settings.count

  async function generate() {
    setError(null)
    setGenerating(true)
    setOutcome(null)
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
      await generateQuestionsStream({ topicId: topic.id, ...settings }, (event) => {
        if (event.type === 'progress') {
          cast = { done: event.done, total: event.total }
          prubeh()
        } else if (event.type === 'saved') {
          hotovo = event.created
          // Nejnovější nahoře — stejně jako seznam otázek pod tím.
          setFresh((current) => [...event.questions.slice().reverse(), ...current])
          prubeh()
        } else if (event.type === 'done') {
          setStatus(null)
          // Podrobný souhrn (co se zahodilo, kolikrát model selhal) má jedno
          // místo — trvalý řádek v kartě. Bublina jen upozorní, že je hotovo,
          // ať se táž věta nečte dvakrát vedle sebe.
          setOutcome(summarizeRun(event))
          toast.success(
            event.created > 0
              ? `Hotovo, ${event.created} ${plural(event.created, 'nová', 'nové', 'nových')} ${plural(event.created, ...OTAZKY)}.`
              : 'Hotovo, ale nevznikla ani jedna otázka.',
            { duration: 12_000 },
          )
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
      {/* Náhled si téma prohlíží a tiskne, ale negeneruje — karta by mu jen
          nabízela tlačítko, které skončí odmítnutím. */}
      {ai.configured && muzeMenit ? (
        <Card className="gap-2 p-3">
          {/* Karta byla nadpis, dva odstavce a teprve pak tlačítko. Podstatné
              je jediné: tlačítko, kolik otázek vznikne a kde se to doladí —
              zbytek patří do nastavení, které je hned vedle. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={lowContent ? 'outline' : 'default'}
              disabled={generating || usable.length === 0 || willCreate === 0}
              onClick={() => void generate()}
            >
              {usableCount > 0 ? 'Dogenerovat otázky' : 'Generovat otázky'}
            </Button>
            <span className="text-sm text-fg-muted">
              {willCreate === 0
                ? 'Zvolený počet je už naplněný, nic se nevytvoří.'
                : topUp
                  ? `Doplní se ${pocet(willCreate, OTAZKY)}.`
                  : `Vznikne ${pocet(willCreate, OTAZKY)}.`}
            </span>
            <div className="ml-auto">
              <GenerateSettingsForm
                value={settings}
                onChange={setSettings}
                disabled={generating}
                note={
                  <p className="text-xs text-fg-muted">
                    Model {ai.model} dostane všechny materiály tématu naráz, aby se otázky
                    neopakovaly; stávající otázky dostane jako seznam, kterému se má vyhnout.
                    Materiály označené jako duplicitní obsah se vynechávají.
                  </p>
                }
              />
            </div>
          </div>

          {lowContent ? (
            <p className="text-sm text-fg-muted">
              Materiálů je v tomhle tématu málo — otázek vznikne jen pár a budou se opakovat.
            </p>
          ) : null}

          {generating ? <ProgressLine label={status ?? 'Spouštím generování…'} /> : null}

          {/* Souhrn běhu zůstává na obrazovce i po zmizení hlášky — nové otázky
              jsou hned vidět jako karty pod tím, není kam dál chodit. */}
          {!generating && outcome ? <p className="text-sm text-fg-soft">{outcome}</p> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </Card>
      ) : muzeMenit ? (
        <AiUnavailable problems={ai.problems} />
      ) : null}

      {muzeMenit ? <ClaudeCodeImport topicId={topic.id} /> : null}

      {group}

      {listTruncated ? (
        <p className="text-sm text-fg-muted">
          Otázek je v tomhle tématu víc, než se sem vejde — vypisuje se prvních {listLimit}{' '}
          od nejnovější. Zbytek najdeš v bance otázek, kde se dá filtrovat i hledat.
        </p>
      ) : null}

      <TopicQuestions topic={topic} defaultTemplateId={defaultTemplateId} questions={shownQuestions} usage={usage} />
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
    // Věta nesmí záviset na počtu: „1 otázka — byly neúplné“ se neshodovalo.
    parts.push(`Zahozeno: ${pocet(event.rejected, OTAZKY)} — neúplné nebo si odporovaly.`)
  }
  if (event.failedCalls > 0) {
    parts.push(`${event.failedCalls}× model odpověděl něčím, co se nedalo použít.`)
  }
  // Když se v jednom tématu vystřídalo víc modelů, otázky nemusí být stejně
  // kvalitní — učitelka to má vědět dřív, než je začne číst.
  if ((event.models?.length ?? 0) > 1) parts.push('Otázky psalo víc různých modelů, kvalita se může lišit.')
  return parts.join(' ')
}
