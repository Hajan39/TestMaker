'use client'

import { useState } from 'react'
import { AI_QUESTION_TYPES, QUESTION_TYPE_LABELS, type QuestionType } from '@testmaker/core/schema'
import { Loader2 } from 'lucide-react'
import {
  Card,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@testmaker/ui'

export interface GenerateSettings {
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
}

export const DEFAULT_SETTINGS: GenerateSettings = {
  count: 12,
  types: [...AI_QUESTION_TYPES],
  difficulty: 'mix',
}

/** Společné nastavení generování — používá se u jednoho materiálu i u fronty. */
export function GenerateSettingsForm({
  value,
  onChange,
  disabled,
}: {
  value: GenerateSettings
  onChange: (next: GenerateSettings) => void
  disabled?: boolean
}) {
  const toggleType = (type: QuestionType) => {
    const types = value.types.includes(type)
      ? value.types.filter((t) => t !== type)
      : [...value.types, type]
    if (types.length > 0) onChange({ ...value, types })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div className="w-28">
          <Label htmlFor="generate-count">Počet otázek</Label>
          <Input
            id="generate-count"
            type="number"
            min={1}
            max={60}
            value={value.count}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, count: Number(event.target.value) || 1 })}
          />
        </div>
        <div className="w-40">
          <Label htmlFor="generate-difficulty">Obtížnost</Label>
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
              <SelectItem value="mix">Promíchat</SelectItem>
              <SelectItem value="1">Lehká</SelectItem>
              <SelectItem value="2">Střední</SelectItem>
              <SelectItem value="3">Těžká</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Typy otázek</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {AI_QUESTION_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-sm text-fg-soft">
              <Checkbox
                checked={value.types.includes(type)}
                disabled={disabled}
                onCheckedChange={() => toggleType(type)}
              />
              {QUESTION_TYPE_LABELS[type]}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AiUnavailable({ provider }: { provider: string }) {
  return (
    <Card className="border-draft-bg bg-draft-bg/40 p-4 text-sm text-draft-fg">
      Generování je vypnuté: pro poskytovatele <strong>{provider}</strong> chybí přístupový klíč.
      Doplň <code>ANTHROPIC_API_KEY</code> do <code>.env.local</code> a restartuj aplikaci.
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
