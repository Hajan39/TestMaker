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

const DUVODY = Object.entries(REGENERATE_REASONS) as [
  RegenerateReason,
  (typeof REGENERATE_REASONS)[RegenerateReason],
][]

/**
 * Nechá model vyrobit náhradu jedné otázky — rozdělené tlačítko do kontroly
 * otázek, kde je na akce místo v celé ploše.
 *
 * Hlavní část přegeneruje hned, beze změny dosavadního chování (jedno
 * kliknutí, žádný důvod). Šipka vedle ní otevře nabídku sedmi důvodů
 * s nepovinnou poznámkou — výběr štítku rovnou přegeneruje s tím důvodem
 * (poznámka jde vyplnit ještě předtím).
 *
 * Bez nakonfigurovaného modelu se tlačítko vůbec nenabídne (jinak by
 * učitelka klikla a dozvěděla se to až z chyby). Rozhodování o tom i
 * samotná náhrada jsou v `useRegenerateQuestion`, aby se tatáž akce dala
 * nabídnout i jinde.
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
  /** Zavolá se po úspěšné náhradě; bez něj se jen obnoví stránka. */
  onDone?: () => void
  /** Zavolá se po vzniku lehčí nebo těžší verze — nová karta se má hned objevit a posunout do zorného pole. */
  onVariantCreated?: (question: Question) => void
  /** Karta podle toho zakáže úpravu a smazání, dokud model na otázce pracuje. */
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

  function vybratDuvod(reason: RegenerateReason) {
    setOpen(false)
    const poznamka = note.trim() || undefined
    setNote('')
    void run(reason, poznamka)
  }

  return (
    <div className="inline-flex shrink-0">
      <BusyButton
        size="sm"
        variant="ghost"
        className="rounded-r-none"
        busy={busy}
        busyLabel="Přegeneruji…"
        disabled={variant.busyDirection !== null}
        onClick={() => void run()}
      >
        Přegenerovat
      </BusyButton>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-l-none border-l"
            disabled={busy || variant.busyDirection !== null}
            aria-label="Přegenerovat s důvodem"
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="px-2 py-1.5">
            <label htmlFor={`regen-poznamka-${questionId}`} className="text-xs text-fg-muted">
              Napiš poznámku a pak vyber důvod
            </label>
            <Textarea
              id={`regen-poznamka-${questionId}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Co konkrétně přepsat…"
              className="mt-1 min-h-14 text-sm"
              maxLength={300}
            />
          </div>
          <DropdownMenuSeparator />
          {DUVODY.map(([reason, { label }]) => (
            <DropdownMenuItem key={reason} onSelect={() => vybratDuvod(reason)}>
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {(['easier', 'harder'] as const).map((direction) => {
            const label = direction === 'easier' ? 'Lehčí verze' : 'Těžší verze'
            const busyLabel = direction === 'easier' ? 'Vytvářím lehčí verzi…' : 'Vytvářím těžší verzi…'
            const duvod = variant.disabledReason(direction)
            const isBusy = variant.busyDirection === direction
            const hintId = `verze-hint-${direction}-${questionId}`
            return (
              <DropdownMenuItem
                key={direction}
                aria-describedby={duvod ? hintId : undefined}
                disabled={duvod !== null || variant.busyDirection !== null}
                onSelect={(event) => {
                  // Menu zůstává otevřené, dokud verze nevznikne (nebo
                  // neselže) — jinak by byl text „Vytvářím…" i disabled
                  // druhé položky vidět jen bleskově, než se menu zavře.
                  event.preventDefault()
                  void variant.create(direction).then(() => setOpen(false))
                }}
              >
                <div className="flex flex-col">
                  <span>{isBusy ? busyLabel : label}</span>
                  {duvod ? (
                    <span id={hintId} className="text-xs text-fg-muted">
                      {duvod}
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
