'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { AI_QUESTION_TYPES, questionTypeLabel, type QuestionType } from '@testmaker/core/schema'
import { ChevronDown, Loader2 } from 'lucide-react'
import {
  Button,
  Card,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

export interface GenerateSettings {
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
  /** `add` = this many new questions, `target` = top the topic up to this count. */
  mode: 'add' | 'target'
}

export const DEFAULT_SETTINGS: GenerateSettings = {
  count: 12,
  types: [...AI_QUESTION_TYPES],
  difficulty: 'mix',
  mode: 'add',
}

/** Shared generation settings — used for a single material and for the queue. */
export function GenerateSettingsForm({
  value,
  onChange,
  disabled,
  note,
}: {
  value: GenerateSettings
  onChange: (next: GenerateSettings) => void
  disabled?: boolean
  /** Detail to explain down here — at the top of the screen it would get in the way. */
  note?: ReactNode
}) {
  // Own ids per component — hard-coded `generate-count`/`generate-mode`/
  // `generate-difficulty` collided with `SimpleGenerateSettingsForm` below
  // whenever both forms ended up on the same page.
  const countId = useId()
  const modeId = useId()
  const difficultyId = useId()

  return (
    <Collapsible data-testid="generate-settings-full">
      <CollapsibleTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="group -ml-2.5 gap-1.5">
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
          {t('generation:generateDialog.settings')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">
        <div className="flex flex-wrap gap-3">
          <div className="w-28">
            <Label htmlFor={countId}>{t('generation:generateDialog.count')}</Label>
            <Input
              id={countId}
              type="number"
              min={1}
              max={60}
              value={value.count}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, count: clampCount(event.target.value) })}
            />
          </div>
          <div className="w-56">
            <Label htmlFor={modeId}>{t('generation:generateDialog.mode')}</Label>
            <Select
              value={value.mode}
              disabled={disabled}
              onValueChange={(next) => onChange({ ...value, mode: next === 'target' ? 'target' : 'add' })}
            >
              <SelectTrigger id={modeId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">{t('generation:generateDialog.modeAdd')}</SelectItem>
                <SelectItem value="target">{t('generation:generateDialog.modeTarget')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Label htmlFor={difficultyId}>{t('generation:generateDialog.difficulty')}</Label>
            <Select
              value={String(value.difficulty)}
              disabled={disabled}
              onValueChange={(next) =>
                onChange({
                  ...value,
                  difficulty: next === 'mix' ? 'mix' : (Number(next) as 1 | 2 | 3),
                })
              }
            >
              <SelectTrigger id={difficultyId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mix">{t('generation:generateDialog.mix')}</SelectItem>
                <SelectItem value="1">{t('generation:generateDialog.easy')}</SelectItem>
                <SelectItem value="2">{t('generation:generateDialog.medium')}</SelectItem>
                <SelectItem value="3">{t('generation:generateDialog.hard')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <QuestionTypesField
          value={value.types}
          onChange={(types) => onChange({ ...value, types })}
          disabled={disabled}
        />
        {note}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Which question types to generate — in a topic and in bulk generation alike.
 * An empty choice is allowed while clicking, but explained right here and the
 * caller disables generation (`types.length === 0`); silently refusing to
 * untick the last box looked like a broken checkbox.
 */
export function QuestionTypesField({
  value,
  onChange,
  disabled,
}: {
  value: QuestionType[]
  onChange: (next: QuestionType[]) => void
  disabled?: boolean
}) {
  const errorId = useId()
  const empty = value.length === 0
  // Kept in `AI_QUESTION_TYPES` order — generation schedules types in that order (`distributeTypes`).
  const toggle = (type: QuestionType) =>
    onChange(AI_QUESTION_TYPES.filter((item) => (item === type ? !value.includes(item) : value.includes(item))))

  return (
    <fieldset aria-describedby={empty ? errorId : undefined} aria-invalid={empty || undefined}>
      <legend className="ui-label mb-2">{t('generation:generateDialog.types')}</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {AI_QUESTION_TYPES.map((type) => (
          <label key={type} className="flex items-center gap-1.5 text-sm text-fg-soft">
            <Checkbox checked={value.includes(type)} disabled={disabled} onCheckedChange={() => toggle(type)} />
            {questionTypeLabel(type)}
          </label>
        ))}
        {/* There are nine types; clicking them back one by one is needless work. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || value.length === AI_QUESTION_TYPES.length}
          className="h-6 px-1.5 text-xs"
          onClick={() => onChange([...AI_QUESTION_TYPES])}
        >
          {t('generation:generateDialog.selectAll')}
        </Button>
      </div>
      {empty ? (
        <p id={errorId} className="mt-1.5 text-sm text-danger" data-testid="generate-types-error">
          {t('generation:generateDialog.typesRequired')}
        </p>
      ) : null}
    </fieldset>
  )
}

/**
 * The teacher's last choice of question types, the same in every topic and in
 * bulk generation, remembered in the browser (zustand `persist`, like the
 * question cart). Unknown types from an older version are ignored; when
 * nothing usable is stored — or storage is unavailable — all types are used.
 * An empty choice is never stored: it is not a valid choice to come back to.
 */
const useTypesStore = create<{ types: QuestionType[]; setTypes: (types: QuestionType[]) => void }>()(
  persist((set) => ({ types: [...AI_QUESTION_TYPES], setTypes: (types) => set({ types }) }), {
    name: 'testmaker:typy-otazek',
    storage: createJSONStorage(() => localStorage),
    partialize: (store) => (store.types.length > 0 ? { types: store.types } : {}),
    merge: (stored, current) => {
      const saved = (stored as { types?: unknown } | undefined)?.types
      const known = Array.isArray(saved) ? AI_QUESTION_TYPES.filter((type) => saved.includes(type)) : []
      return { ...current, types: known.length > 0 ? known : current.types }
    },
    // The server and the first browser pass render all types; the stored choice comes right after.
    skipHydration: true,
  }),
)

export function useRememberedTypes(): [QuestionType[], (types: QuestionType[]) => void] {
  useEffect(() => {
    void useTypesStore.persist.rehydrate()
  }, [])
  const types = useTypesStore((store) => store.types)
  const setTypes = useTypesStore((store) => store.setTypes)
  return [types, setTypes]
}

/**
 * Why generation is unavailable. The first sentence is enough for the teacher;
 * the list below is for the owner who fixes the settings in `.env.local` (`describeAiSetup`).
 */
export function AiUnavailable({ problems }: { problems: string[] }) {
  return (
    <Card className="flex flex-col gap-1 border-draft-bg bg-draft-bg/40 text-sm text-draft-fg">
      <p>{t('generation:generateDialog.notConfigured')}</p>
      {problems.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

export function ProgressLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-soft">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

export function useGenerateSettings(initial: GenerateSettings = DEFAULT_SETTINGS) {
  return useState<GenerateSettings>(initial)
}

/**
 * Generation settings right in the topic: count and difficulty; question types
 * sit in their own row (`QuestionTypesField`). The "Doplnit na celkový počet"
 * mode is deliberately missing — a topic always adds new questions; topping up
 * suits bulk generation (`GenerateSettingsForm` above).
 */
export interface SimpleGenerateSettings {
  count: number
  difficulty: 1 | 2 | 3 | 'mix'
}

export const DEFAULT_SIMPLE_SETTINGS: SimpleGenerateSettings = {
  count: 10,
  difficulty: 'mix',
}

/** Clamps the entered count to an integer 1–60 — the server enforces the same range itself (`enqueueSchema`). */
function clampCount(raw: string): number {
  const parsed = Math.round(Number(raw))
  if (!Number.isFinite(parsed)) return 1
  return Math.min(60, Math.max(1, parsed))
}

export function SimpleGenerateSettingsForm({
  value,
  onChange,
  disabled,
}: {
  value: SimpleGenerateSettings
  onChange: (next: SimpleGenerateSettings) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <div className="w-24">
        <Label htmlFor="generate-count">{t('generation:generateDialog.countShort')}</Label>
        <Input
          id="generate-count"
          type="number"
          min={1}
          max={60}
          value={value.count}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, count: clampCount(event.target.value) })}
        />
      </div>
      <div className="w-48">
        {/* Its own name, not a generic "Obtížnost" — the question filter below has
            the same name and `getByLabel('Obtížnost')` would otherwise match both. */}
        <Label htmlFor="generate-difficulty">{t('generation:generateDialog.newDifficulty')}</Label>
        <Select
          value={String(value.difficulty)}
          disabled={disabled}
          onValueChange={(next) =>
            onChange({
              ...value,
              difficulty: next === 'mix' ? 'mix' : (Number(next) as 1 | 2 | 3),
            })
          }
        >
          <SelectTrigger id="generate-difficulty" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mix">{t('generation:generateDialog.mix')}</SelectItem>
            <SelectItem value="1">{t('generation:generateDialog.easyPlural')}</SelectItem>
            <SelectItem value="2">{t('generation:generateDialog.medium')}</SelectItem>
            <SelectItem value="3">{t('generation:generateDialog.hardPlural')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
