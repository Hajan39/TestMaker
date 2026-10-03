'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AI_QUESTION_TYPES, type Question } from '@testmaker/core/schema'
import { Button, Card, EmptyState, toast } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import {
  AiUnavailable,
  DEFAULT_SIMPLE_SETTINGS,
  ProgressLine,
  SimpleGenerateSettingsForm,
  type SimpleGenerateSettings,
} from '@/components/GenerateDialog'
import { announceGeneration } from '@/components/GenerationStatus'
import { ClaudeCodeImport } from '@/components/ClaudeCodeImport'
import type { GroupMaterial } from '@/components/MaterialRow'
import { MaterialsStrip, type MaterialsStripHandle } from '@/components/MaterialsStrip'
import { TopicQuestions, type TestUsage, type TopicQuestionsHandle, type VariantLink } from '@/components/TopicQuestions'
import { generateQuestionsStream } from '@/lib/generateClient'
import { errorMessage } from '@/lib/requestJson'
import { isUsableMaterial, MIN_GENERATE_CHARS } from '@/lib/materials'
import { useCanEdit } from '@/components/Permissions'

export function TopicWorkspace({
  topic,
  defaultTemplateId,
  materials,
  questions,
  usage,
  rejectedCount,
  variantLinks,
  listTruncated,
  listLimit,
  lowContent,
  usableCharCount,
  ai,
}: {
  /** Topic metadata needed to create a test straight from the question selection. */
  topic: { id: string; name: string; subjectName: string; gradeId: string; gradeName: string }
  /** Default template for a new test (the same choice as for a test from scratch). */
  defaultTemplateId: string
  /** The topic's materials — passed unchanged to the materials strip below the main action. */
  materials: GroupMaterial[]
  questions: Question[]
  /** Tests that already contain the questions — only those the caller can see. */
  usage: Record<string, TestUsage[]>
  /** Number of the topic's deleted (rejected) questions — for the „Smazané" toggle. */
  rejectedCount: number
  /** Easier and harder versions by root, for the „Verze: …" row on the question card. */
  variantLinks: Record<string, VariantLink[]>
  /** The question list is cut off by a limit — the topic has more than are listed. */
  listTruncated: boolean
  /** The most questions listed; for the message about the truncated list. */
  listLimit: number
  /** Too little usable text (without duplicates) for a test — generation stays possible, just not as the default choice. */
  lowContent: boolean
  /** The topic's usable text in characters — the same number the page shows in `StatRow`. */
  usableCharCount: number
  ai: { configured: boolean; provider: string; model: string; problems: string[] }
}) {
  const canEdit = useCanEdit()
  const router = useRouter()
  const [settings, setSettings] = useState<SimpleGenerateSettings>(DEFAULT_SIMPLE_SETTINGS)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Questions created in this run. The list below only refreshes once the run
   * finishes (router.refresh), and waiting for that means staring at a spinner
   * for ten minutes — these are added to the list as soon as the server saves them.
   */
  const [fresh, setFresh] = useState<Question[]>([])
  /** A finished run: the summary stays on screen even after the toast disappears. */
  const [outcome, setOutcome] = useState<{ text: string; created: number; rejected: number } | null>(null)
  const [doneCount, setDoneCount] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const materialsStripRef = useRef<MaterialsStripHandle>(null)
  const topicQuestionsRef = useRef<TopicQuestionsHandle>(null)
  // Uploading the first material or writing the first question from the empty
  // state reveals the rest of the page before `router.refresh()` finishes —
  // otherwise the button in `EmptyState` would have to target a hidden area.
  const [revealed, setRevealed] = useState(false)
  // While the materials strip reads or saves a file, generation would grab
  // text that is not ready yet — so the button waits until the strip reports
  // it is idle.
  const [materialsUploading, setMaterialsUploading] = useState(false)

  // Generation only runs while the page is open — closing or reloading cuts
  // it off, so the browser asks first.
  useEffect(() => {
    if (!generating) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [generating])

  // After the list refreshes, the same questions also arrive in `questions` —
  // fresh ones already in the list are skipped by id so they don't repeat.
  const shownQuestions = useMemo(() => {
    const known = new Set(questions.map((question) => question.id))
    return [...fresh.filter((question) => !known.has(question.id)), ...questions]
  }, [fresh, questions])

  // Show only what really goes to the model: generation always skips
  // duplicate content, manually excluded materials and scans without a text
  // layer, so they must not count here either — otherwise the screen shows a
  // big number with a warning about too few materials right below it.
  const usable = materials.filter(isUsableMaterial)
  // The same threshold generation enforces on the server (`MIN_GENERATE_CHARS`) —
  // the button is disabled before the teacher would wait for an error message.
  const tooLittleText = usableCharCount < MIN_GENERATE_CHARS
  // A topic with no content at all (no material, no question) gets a single
  // prompt instead of the generation card and materials strip — both would
  // just show their own empty states side by side.
  const isEmpty = materials.length === 0 && questions.length === 0
  const showEmptyState = isEmpty && canEdit && !revealed

  async function generate() {
    setError(null)
    setGenerating(true)
    setOutcome(null)
    setFresh([])
    setDoneCount(0)
    setStatus(t('generation:topicGeneration.starting'))
    announceGeneration()
    abortRef.current = new AbortController()
    // Progress has two parts: how many questions are done (what the teacher
    // cares about) and where the model is in the materials (which only hints
    // at how long it will still take).
    let done = 0
    let cast: { done: number; total: number } | null = null
    // A stream ending without `done` or `error` (dropped connection, timed-out
    // function) used to end silently — the spinner vanished and nothing was said.
    let started = false
    let finished = false
    const interrupted = () => {
      setStatus(null)
      setError(t('generation:topicGeneration.interrupted'))
      router.refresh()
    }
    const progress = () => {
      setDoneCount(done)
      const doneText = done > 0 ? t('generation:topicGeneration.doneSoFar', { count: done }) : t('generation:topicGeneration.noneDoneYet')
      // `done` is the number of parts already processed, so work is on the next.
      // When the last one is done too, nothing remains and there is nothing to report.
      const remaining = cast && cast.done < cast.total
      setStatus(remaining ? `${doneText} · ${t('generation:topicGeneration.workingOnPart', { part: cast!.done + 1, total: cast!.total })}` : doneText)
    }

    try {
      // Types and mode are not chosen in a topic — everything the model can do
      // is always sent, and new questions are always added (never „doplnit na
      // celkový počet"); that is for bulk generation, not for a single topic.
      await generateQuestionsStream(
        { topicId: topic.id, count: settings.count, difficulty: settings.difficulty, types: [...AI_QUESTION_TYPES] },
        (event) => {
          started = true
          if (event.type === 'done' || event.type === 'error') finished = true
          if (event.type === 'progress') {
            cast = { done: event.done, total: event.total }
            progress()
          } else if (event.type === 'saved') {
            done = event.created
            // Newest on top — just like the question list below.
            setFresh((current) => [...event.questions.slice().reverse(), ...current])
            progress()
          } else if (event.type === 'done') {
            setStatus(null)
            // The detailed summary (what was discarded, how often the model
            // failed) has one place — a lasting line in the card. The toast only
            // says it is done, so the same sentence isn't read twice side by side.
            setOutcome({ text: summarizeRun(event), created: event.created, rejected: event.rejected })
            toast.success(
              event.created > 0
                ? t('generation:topicGeneration.doneToast', { count: event.created })
                : t('generation:topicGeneration.doneToastNone'),
              { duration: 12_000, testId: 'toast-generation-done' },
            )
            router.refresh()
          } else if (event.type === 'error') setError(event.message)
        },
        abortRef.current.signal,
      )
      if (!finished) interrupted()
    } catch (streamError) {
      if (started && !finished) interrupted()
      else setError(errorMessage(streamError, t('generation:topicGeneration.failed')))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div
      className="space-y-5"
      // A file dropped outside the materials strip would by default be opened
      // by the browser as a new page and the teacher would lose her work. The
      // whole topic area therefore takes over the drop and passes it to the
      // strip as if dropped right on it — the strip's own zone does not let the
      // drop through (`stopPropagation`), so it is not handled twice.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (canEdit) materialsStripRef.current?.handleExternalDrop(event.dataTransfer)
      }}
    >
      {/* A topic with no content gets one clear prompt instead of the
          generation card and materials strip — both would just show their own
          empty states side by side. It disappears once something is added
          (`router.refresh()` after saving); `revealed` only runs ahead of it. */}
      {showEmptyState ? (
        <EmptyState
          testId="topic-empty"
          title={t('library:topicWorkspace.emptyTitle')}
          hint={t('library:topicWorkspace.emptyHint')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                onClick={() => {
                  setRevealed(true)
                  materialsStripRef.current?.openUpload()
                }}
              >
                {t('library:topicWorkspace.uploadMaterial')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setRevealed(true)
                  topicQuestionsRef.current?.openCreate()
                }}
              >
                {t('library:topicWorkspace.writeQuestion')}
              </Button>
            </div>
          }
        />
      ) : ai.configured && canEdit ? (
        /* A viewer browses and prints the topic but does not generate — the
           card would only offer a button that ends in a refusal. */
        <Card className="gap-2 p-3">
          {/* The card used to be a heading, two paragraphs and only then a
              button. Only one thing matters: the button, how many questions
              will be created and where to fine-tune it — the rest belongs in
              the settings right next to it. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={lowContent ? 'outline' : 'default'}
              disabled={generating || usable.length === 0 || tooLittleText || materialsUploading}
              onClick={() => void generate()}
            >
              {t('generation:topicGeneration.generate')}
            </Button>
            <span
              className="text-sm text-fg-muted"
              data-testid="generate-hint"
              data-state={
                materialsUploading ? 'uploading' : usable.length === 0 ? 'no-material' : tooLittleText ? 'too-little-text' : 'will-create'
              }
              data-count={settings.count}
              data-materials={usable.length}
            >
              {materialsUploading
                ? t('generation:topicGeneration.waitForUpload')
                : usable.length === 0
                  ? t('generation:topicGeneration.noUsableMaterial')
                  : tooLittleText
                    ? t('generation:topicGeneration.tooLittleText')
                    : t('generation:topicGeneration.willCreate', { questions: t('library:count.questions', { count: settings.count }), materials: t('library:count.materialsGenitive', { count: usable.length }) })}
            </span>
            <div className="ml-auto">
              <SimpleGenerateSettingsForm value={settings} onChange={setSettings} disabled={generating} />
            </div>
          </div>

          {lowContent ? (
            <p className="text-sm text-fg-muted" data-testid="thin-topic-warning">
              {t('generation:topicGeneration.lowContent')}
            </p>
          ) : null}

          {generating ? (
            <div data-testid="generation-progress" data-done={doneCount}>
              <ProgressLine label={status ?? t('generation:topicGeneration.starting')} />
            </div>
          ) : null}

          {/* The run summary stays on screen after the toast disappears — the new
              questions are visible right away as cards below, nowhere else to go. */}
          {!generating && outcome ? (
            <p
              className="text-sm text-fg-soft"
              data-testid="generation-outcome"
              data-created={outcome.created}
              data-rejected={outcome.rejected}
            >
              {outcome.text}
            </p>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </Card>
      ) : canEdit ? (
        <AiUnavailable problems={ai.problems} />
      ) : null}

      {canEdit && !showEmptyState ? <ClaudeCodeImport topicId={topic.id} /> : null}

      <div className={showEmptyState ? 'hidden' : undefined}>
        <MaterialsStrip
          ref={materialsStripRef}
          topicId={topic.id}
          topicName={topic.name}
          materials={materials}
          onBusyChange={setMaterialsUploading}
        />
      </div>

      {listTruncated ? (
        <p className="text-sm text-fg-muted">
          {t('library:topicWorkspace.listTruncated', { limit: listLimit })}
        </p>
      ) : null}

      <div className={showEmptyState ? 'hidden' : undefined}>
        <TopicQuestions
          ref={topicQuestionsRef}
          topic={topic}
          defaultTemplateId={defaultTemplateId}
          questions={shownQuestions}
          usage={usage}
          rejectedCount={rejectedCount}
          variantLinks={variantLinks}
        />
      </div>
    </div>
  )
}

/**
 * A sentence on how generation went: how many questions were created, how
 * many discarded and why. Discarded questions are not the teacher's fault —
 * but when there are many, it is the only trace that the model struggles
 * with the material.
 */
function summarizeRun(event: {
  created: number
  rejected: number
  failedCalls: number
  sources: number
  models?: string[]
}): string {
  if (event.created === 0) {
    return t('generation:topicGeneration.summaryNone')
  }
  const parts = [t('generation:topicGeneration.summaryCreated', { questions: t('library:count.questions', { count: event.created }) })]
  if (event.rejected > 0) {
    // The sentence must not depend on the count: „1 otázka — byly neúplné“ did not agree.
    parts.push(t('generation:topicGeneration.summaryRejected', { questions: t('library:count.questions', { count: event.rejected }) }))
  }
  if (event.failedCalls > 0) {
    parts.push(t('generation:topicGeneration.summaryFailedCalls', { count: event.failedCalls }))
  }
  // When several models took turns on one topic, the questions may differ in
  // quality — the teacher should know before she starts reading them.
  if ((event.models?.length ?? 0) > 1) parts.push(t('generation:topicGeneration.summaryMixedModels'))
  return parts.join(' ')
}
