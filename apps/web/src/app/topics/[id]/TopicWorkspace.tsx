'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question } from '@testmaker/core/schema'
import { Button, Card, OTAZKY, pocet } from '@testmaker/ui'
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
  const abortRef = useRef<AbortController | null>(null)

  // Ukazujeme jen to, co skutečně půjde do modelu: generování duplicitní
  // obsah vynechává, takže se nesmí počítat ani tady — jinak na obrazovce
  // stojí velké číslo a hned pod ním upozornění, že materiálů je málo.
  const usable = materials.filter((material) => !material.duplicateOfId)
  const topUp = settings.mode === 'target'
  const willCreate = topUp ? Math.max(0, settings.count - keptCount) : settings.count

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
            `Vytvořeno ${pocet(event.created, OTAZKY)} z ${event.sources} materiálů` +
              // Když se v jednom tématu vystřídalo víc modelů, otázky nemusí být
              // stejně kvalitní — učitelka to má vědět dřív, než je začne číst.
              ((event.models?.length ?? 0) > 1 ? `, modely: ${event.models?.join(' → ')}` : '') +
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
            {generating ? <ProgressLine label={status ?? 'Generuji…'} /> : null}
            {!generating && status ? <span className="text-sm text-brand">{status}</span> : null}
          </div>
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

      <ReviewPanel topicId={topicId} questions={questions} />
    </div>
  )
}
