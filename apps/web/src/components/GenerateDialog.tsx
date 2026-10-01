'use client'

import { useId, useState, type ReactNode } from 'react'
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

  const toggleType = (type: QuestionType) => {
    const types = value.types.includes(type)
      ? value.types.filter((item) => item !== type)
      : [...value.types, type]
    if (types.length > 0) onChange({ ...value, types })
  }

  return (
    <Collapsible>
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

        <div>
          <div className="flex items-center gap-3">
            <Label>{t('generation:generateDialog.types')}</Label>
            {/* There are nine types; clicking them back one by one is needless work.
                The opposite button is missing on purpose — generating with
                no type makes no sense. */}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || value.types.length === AI_QUESTION_TYPES.length}
              className="h-6 px-1.5 text-xs"
              onClick={() => onChange({ ...value, types: [...AI_QUESTION_TYPES] })}
            >
              {t('generation:generateDialog.selectAll')}
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {AI_QUESTION_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-1.5 text-sm text-fg-soft">
                <Checkbox
                  checked={value.types.includes(type)}
                  disabled={disabled}
                  onCheckedChange={() => toggleType(type)}
                />
                {questionTypeLabel(type)}
              </label>
            ))}
          </div>
        </div>
        {note}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Why generation is unavailable. The first sentence is enough for the teacher;
 * the list below is for the owner who fixes the settings in `.env.local` (`describeAiSetup`).
 */
export function AiUnavailable({ problems }: { problems: string[] }) {
  return (
    <Card className="gap-1 border-draft-bg bg-draft-bg/40 p-4 text-sm text-draft-fg">
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
 * Generation settings right in the topic: just count and difficulty. Type
 * selection and the "Doplnit na celkový počet" mode are deliberately missing —
 * in a topic it always generates all types the model can attempt and always
 * adds new questions. Those options suit bulk generation (`GenerateSettingsForm`
 * above), not a single topic where they'd only slow things down.
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
      <div className="w-36">
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
