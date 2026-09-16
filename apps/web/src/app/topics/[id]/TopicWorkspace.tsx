'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question } from '@testmaker/core/schema'
import { Button, Card } from '@testmaker/ui'
import {
  DEFAULT_SETTINGS,
  GenerateSettingsForm,
  ProgressLine,
  type GenerateSettings,
} from '@/components/GenerateDialog'
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
  lowContent,
  ai,
  group,
}: {
  topicId: string
  materials: MaterialSummary[]
  questions: Question[]
  /** Použitelného textu (bez duplicit) je málo na písemku — generování zůstává možné, jen ne jako výchozí volba. */
  lowContent: boolean
  ai: { configured: boolean; provider: string; model: string }
  /** Skupina materiálů — vykreslí se mezi hlavní akcí a seznamem otázek. */
  group: React.ReactNode
}) {
  const router = useRouter()
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Ukazujeme jen to, co skutečně půjde do modelu: generování duplicitní
  // obsah vynechává, takže se nesmí počítat ani tady — jinak na obrazovce
  // stojí velké číslo a hned pod ním upozornění, že materiálů je málo.
  const usable = materials.filter((material) => !material.duplicateOfId)
  // Zamítnuté se nepočítají — po kontrole konceptů je smysl doplňovat právě
  // na počet těch, které v tématu zůstaly použitelné.
  const kept = questions.filter((question) => question.status !== 'rejected').length
  const topUp = settings.mode === 'target'
  const willCreate = topUp ? Math.max(0, settings.count - kept) : settings.count

  async function generate() {
    setError(null)
    setGenerating(true)
    setStatus('Generuji…')
    abortRef.current = new AbortController()
    try {
      await generateQuestionsStream({ topicId, ...settings }, (event) => {
        if (event.type === 'progress') setStatus(`Zpracovávám část ${event.done} z ${event.total}`)
        else if (event.type === 'done') {
          setStatus(
            `Vytvořeno ${event.created} otázek z ${event.sources} materiálů` +
              (event.rejected > 0 ? `, ${event.rejected} zahozeno` : '') +
              (event.failedCalls > 0 ? `, ${event.failedCalls}× model neodpověděl použitelně` : ''),
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
      {ai.configured ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-fg">Generovat otázky</h2>
          {/* Počty materiálů a otázek stojí nahoře u názvu tématu — tady by se
              jen opakovaly. Zůstává to, co nikde jinde není: co model dostane
              a co z toho vznikne. */}
          <p className="mt-1 text-sm text-fg-muted">
            Model {ai.model} dostane všechny materiály skupiny naráz, aby se otázky neopakovaly.
            Vzniknou jako koncepty ke schválení.
          </p>
          {kept > 0 ? (
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
              Materiálů je v téhle skupině málo — model z nich zvládne vytvořit jen pár otázek a
              některé se budou opakovat. Spolehlivější je nejdřív přidat další materiál nebo téma
              sloučit s příbuzným. Generovat i tak jde, jen počítej s tím, že výsledek bude potřeba
              víc kontrolovat.
            </p>
          ) : null}
          <div className="mt-3">
            <GenerateSettingsForm value={settings} onChange={setSettings} disabled={generating} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant={lowContent ? 'outline' : 'default'}
              disabled={generating || usable.length === 0 || willCreate === 0}
              onClick={() => void generate()}
            >
              {kept > 0 ? 'Dogenerovat ze skupiny' : 'Vygenerovat ze skupiny'}
            </Button>
            {generating ? <ProgressLine label={status ?? 'Generuji…'} /> : null}
            {!generating && status ? <span className="text-sm text-brand">{status}</span> : null}
          </div>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </Card>
      ) : null}

      {group}

      <ReviewPanel topicId={topicId} questions={questions} />
    </div>
  )
}
