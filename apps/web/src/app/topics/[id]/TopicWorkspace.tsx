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
}

export function TopicWorkspace({
  topicId,
  topicName,
  materials,
  questions,
  ai,
  group,
}: {
  topicId: string
  topicName: string
  materials: MaterialSummary[]
  questions: Question[]
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

  const totalChars = materials.reduce((sum, material) => sum + material.charCount, 0)

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
              (event.rejected > 0 ? `, ${event.rejected} zahozeno` : ''),
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
          <p className="mt-1 text-sm text-fg-muted">
            Zdrojem je celá skupina „{topicName}“: {materials.length}{' '}
            {materials.length === 1 ? 'materiál' : 'materiálů'},{' '}
            {totalChars.toLocaleString('cs')} znaků. Model {ai.model} dostane všechny naráz, aby se
            otázky neopakovaly. Vzniknou jako koncepty ke schválení.
          </p>
          <div className="mt-3">
            <GenerateSettingsForm value={settings} onChange={setSettings} disabled={generating} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button disabled={generating || materials.length === 0} onClick={() => void generate()}>
              Vygenerovat ze skupiny
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
