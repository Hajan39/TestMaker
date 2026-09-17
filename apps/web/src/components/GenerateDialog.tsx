'use client'

import { useState, type ReactNode } from 'react'
import { AI_QUESTION_TYPES, QUESTION_TYPE_LABELS, type QuestionType } from '@testmaker/core/schema'
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

export interface GenerateSettings {
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
  /** `add` = tolik nových otázek, `target` = doplnit téma na tenhle počet. */
  mode: 'add' | 'target'
}

export const DEFAULT_SETTINGS: GenerateSettings = {
  count: 12,
  types: [...AI_QUESTION_TYPES],
  difficulty: 'mix',
  mode: 'add',
}

/** Společné nastavení generování — používá se u jednoho materiálu i u fronty. */
export function GenerateSettingsForm({
  value,
  onChange,
  disabled,
  note,
}: {
  value: GenerateSettings
  onChange: (next: GenerateSettings) => void
  disabled?: boolean
  /** Podrobnost k vysvětlení až tady dole — nahoře na obrazovce by zdržovala. */
  note?: ReactNode
}) {
  const toggleType = (type: QuestionType) => {
    const types = value.types.includes(type)
      ? value.types.filter((t) => t !== type)
      : [...value.types, type]
    if (types.length > 0) onChange({ ...value, types })
  }

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="group -ml-2.5 gap-1.5">
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
          Nastavení generování
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">
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
          <div className="w-56">
            <Label htmlFor="generate-mode">Počet otázek znamená</Label>
            <Select
              value={value.mode}
              disabled={disabled}
              onValueChange={(next) => onChange({ ...value, mode: next === 'target' ? 'target' : 'add' })}
            >
              <SelectTrigger id="generate-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">Přidat nové</SelectItem>
                <SelectItem value="target">Doplnit na celkový počet</SelectItem>
              </SelectContent>
            </Select>
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
          <div className="flex items-center gap-3">
            <Label>Typy otázek</Label>
            {/* Typů je devět; naklikat je zpátky po jednom je zbytečná práce.
                Opačné tlačítko tu není schválně — generování bez jediného
                typu nedává smysl. */}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || value.types.length === AI_QUESTION_TYPES.length}
              className="h-6 px-1.5 text-xs"
              onClick={() => onChange({ ...value, types: [...AI_QUESTION_TYPES] })}
            >
              Vybrat vše
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
                {QUESTION_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </div>
        {note}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function AiUnavailable({ provider }: { provider: string }) {
  return (
    <Card className="border-draft-bg bg-draft-bg/40 p-4 text-sm text-draft-fg">
      Generování je vypnuté: pro poskytovatele <strong>{provider}</strong> chybí přístupový klíč.
      Doplň do <code>.env.local</code> podle poskytovatele buď <code>ANTHROPIC_API_KEY</code>
      (případně <code>ANTHROPIC_AUTH_TOKEN</code> z přihlášení přes <code>ant auth login</code>),
      nebo <code>GOOGLE_GENERATIVE_AI_API_KEY</code>, a restartuj aplikaci.
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
