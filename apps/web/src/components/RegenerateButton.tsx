'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Question } from '@testmaker/core/schema'
import { REGENERATE_REASONS, type QuestionType, type RegenerateReason } from '@testmaker/core/schema'
import {
  BusyButton,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Textarea,
} from '@testmaker/ui'
import { useRegenerateQuestion } from '@/components/useRegenerateQuestion'
import { useQuestionVariant } from '@/components/useQuestionVariant'
import { t } from '@testmaker/core/i18n'

const REASONS = Object.entries(REGENERATE_REASONS) as [
  RegenerateReason,
  (typeof REGENERATE_REASONS)[RegenerateReason],
][]

/**
 * Lets the model produce a replacement for one question — a split button for
 * question review, where there is room for actions across the whole area.
 *
 * The main part regenerates right away, keeping the existing behaviour (one
 * click, no reason). The arrow next to it opens a menu of seven reasons with
 * an optional note — picking a label regenerates with that reason straight
 * away (the note can be filled in beforehand).
 *
 * Without a configured model the button is not offered at all (otherwise the
 * teacher would click and only learn from an error). That decision and the
 * replacement itself live in `useRegenerateQuestion`, so the same action can
 * be offered elsewhere too.
 */
export function RegenerateButton({
  questionId,
  type,
  difficulty,
  onDone,
  onVariantCreated,
  onBusyChange,
}: {
  questionId: string
  type: QuestionType
  difficulty: 1 | 2 | 3
  /** Called after a successful replacement; without it the page just refreshes. */
  onDone?: () => void
  /** Called once an easier or harder version exists — the new card should appear right away and scroll into view. */
  onVariantCreated?: (question: Question) => void
  /** The card uses it to disable editing and deleting while the model works on the question. */
  onBusyChange?: (busy: boolean) => void
}) {
  const { available, busy, run } = useRegenerateQuestion(questionId, type, onDone)
  const variant = useQuestionVariant({ id: questionId, type, difficulty }, onVariantCreated)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const anyBusy = busy || variant.busyDirection !== null
  useEffect(() => {
    onBusyChange?.(anyBusy)
  }, [anyBusy, onBusyChange])
  if (!available) return null

  function pickReason(reason: RegenerateReason) {
    setOpen(false)
    const noteText = note.trim() || undefined
    setNote('')
    void run(reason, noteText)
  }

  return (
    <div className="inline-flex shrink-0">
      <BusyButton
        size="sm"
        variant="ghost"
        className="rounded-r-none"
        busy={busy}
        busyLabel={t('generation:regenerate.busy')}
        disabled={variant.busyDirection !== null}
        onClick={() => void run()}
      >
        {t('generation:regenerate.action')}
      </BusyButton>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-l-none border-l"
            disabled={busy || variant.busyDirection !== null}
            aria-label={t('generation:regenerate.withReason')}
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="px-2 py-1.5">
            <label htmlFor={`regen-poznamka-${questionId}`} className="text-xs text-fg-muted">
              {t('generation:regenerate.noteLabel')}
            </label>
            <Textarea
              id={`regen-poznamka-${questionId}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder={t('generation:regenerate.notePlaceholder')}
              className="mt-1 min-h-14 text-sm"
              maxLength={300}
            />
          </div>
          <DropdownMenuSeparator />
          {REASONS.map(([reason, { label }]) => (
            <DropdownMenuItem key={reason} onSelect={() => pickReason(reason)}>
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {(['easier', 'harder'] as const).map((direction) => {
            const label = direction === 'easier' ? t('generation:variant.easier') : t('generation:variant.harder')
            const busyLabel = direction === 'easier' ? t('generation:variant.creatingEasier') : t('generation:variant.creatingHarder')
            const reason = variant.disabledReason(direction)
            const isBusy = variant.busyDirection === direction
            const hintId = `verze-hint-${direction}-${questionId}`
            return (
              <DropdownMenuItem
                key={direction}
                aria-describedby={reason ? hintId : undefined}
                disabled={reason !== null || variant.busyDirection !== null}
                onSelect={(event) => {
                  // The menu stays open until the version exists (or fails) —
                  // otherwise the „Vytvářím…" text and the disabled second
                  // item would only flash before the menu closes.
                  event.preventDefault()
                  void variant.create(direction).then(() => setOpen(false))
                }}
              >
                <div className="flex flex-col">
                  <span>{isBusy ? busyLabel : label}</span>
                  {reason ? (
                    <span id={hintId} className="text-xs text-fg-muted">
                      {reason}
                    </span>
                  ) : null}
                </div>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
