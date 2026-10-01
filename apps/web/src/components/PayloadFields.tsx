'use client'

import { useId } from 'react'
import type { QuestionType } from '@testmaker/core/schema'
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

type Payload = Record<string, unknown>

/** Form fields by question type. Works on an untyped payload; validation happens later via the zod schema. */
export function PayloadFields({
  type,
  payload,
  onChange,
}: {
  type: QuestionType
  payload: Payload
  onChange: (next: Payload) => void
}) {
  const set = (key: string, value: unknown) => onChange({ ...payload, [key]: value })
  const str = (key: string) => String(payload[key] ?? '')
  const list = (key: string) => (payload[key] as string[] | undefined) ?? []

  // A card being edited and „Nová otázka" can be on screen side by side —
  // fixed ids would then repeat and `htmlFor` would point at another field.
  const uid = useId()
  const id = (name: string) => `payload-${name}-${uid}`

  const prompt = (
    <div>
      <Label htmlFor={id('prompt')}>{t('library:payloadFields.prompt')}</Label>
      <Textarea id={id('prompt')} value={str('prompt')} onChange={(event) => set('prompt', event.target.value)} />
    </div>
  )

  switch (type) {
    case 'open':
      return (
        <div className="space-y-3">
          {prompt}
          <div className="flex gap-3">
            <div className="w-32">
              <Label htmlFor={id('lines')}>{t('library:payloadFields.lines')}</Label>
              <Input
                id={id('lines')}
                type="number"
                min={1}
                max={20}
                value={Number(payload.lines ?? 4)}
                onChange={(event) => set('lines', Number(event.target.value) || 1)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor={id('open-answer')}>{t('library:payloadFields.openAnswer')}</Label>
            <Textarea
              id={id('open-answer')}
              value={str('answer')}
              onChange={(event) => set('answer', event.target.value)}
            />
          </div>
        </div>
      )

    case 'draw':
      return (
        <div className="space-y-3">
          {prompt}
          <div className="flex gap-3">
            <div className="w-32">
              <Label htmlFor={id('lines')}>{t('library:payloadFields.space')}</Label>
              <Input
                id={id('lines')}
                type="number"
                min={1}
                max={30}
                value={Number(payload.lines ?? 8)}
                onChange={(event) => set('lines', Number(event.target.value) || 1)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor={id('draw-answer')}>{t('library:payloadFields.drawAnswer')}</Label>
            <Textarea
              id={id('draw-answer')}
              value={str('answer')}
              onChange={(event) => set('answer', event.target.value)}
            />
          </div>
        </div>
      )

    case 'short_answer':
      return (
        <div className="space-y-3">
          {prompt}
          <div>
            <Label htmlFor={id('short-answer')}>{t('library:payloadFields.shortAnswer')}</Label>
            <Input
              id={id('short-answer')}
              value={str('answer')}
              onChange={(event) => set('answer', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={id('accepted-answers')}>{t('library:payloadFields.acceptedAnswers')}</Label>
            <Input
              id={id('accepted-answers')}
              value={list('acceptedAnswers').join('; ')}
              onChange={(event) =>
                set(
                  'acceptedAnswers',
                  event.target.value
                    .split(';')
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
          </div>
        </div>
      )

    case 'single_choice':
    case 'multi_choice': {
      const options = list('options')
      const correctIndices =
        type === 'multi_choice'
          ? ((payload.correctIndices as number[] | undefined) ?? [])
          : [Number(payload.correctIndex ?? 0)]

      const toggleCorrect = (index: number) => {
        if (type === 'single_choice') {
          set('correctIndex', index)
          return
        }
        const next = correctIndices.includes(index)
          ? correctIndices.filter((i) => i !== index)
          : [...correctIndices, index].sort((a, b) => a - b)
        set('correctIndices', next)
      }

      return (
        <div className="space-y-3">
          {prompt}
          <div>
            <Label>{t('library:payloadFields.options')}</Label>
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Checkbox checked={correctIndices.includes(index)} onCheckedChange={() => toggleCorrect(index)} />
                  <Input
                    value={option}
                    onChange={(event) => set('options', replaceAt(options, index, event.target.value))}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set('options', options.filter((_, i) => i !== index))}
                  >
                    {t('library:payloadFields.remove')}
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => set('options', [...options, ''])}>
              {t('library:payloadFields.addOption')}
            </Button>
          </div>
        </div>
      )
    }

    case 'true_false': {
      const statements = (payload.statements as { text: string; isTrue: boolean }[] | undefined) ?? []
      return (
        <div className="space-y-3">
          {prompt}
          <div>
            <Label>{t('library:payloadFields.statements')}</Label>
            <div className="space-y-2">
              {statements.map((statement, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Checkbox
                    checked={statement.isTrue}
                    onCheckedChange={() =>
                      set(
                        'statements',
                        replaceAt(statements, index, { ...statement, isTrue: !statement.isTrue }),
                      )
                    }
                  />
                  <Input
                    value={statement.text}
                    onChange={(event) =>
                      set('statements', replaceAt(statements, index, { ...statement, text: event.target.value }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set('statements', statements.filter((_, i) => i !== index))}
                  >
                    {t('library:payloadFields.remove')}
                  </Button>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => set('statements', [...statements, { text: '', isTrue: true }])}
            >
              {t('library:payloadFields.addStatement')}
            </Button>
          </div>
        </div>
      )
    }

    case 'fill_blank': {
      const blanks = list('blanks')
      const text = str('text')
      const placeholders = (text.match(/___/g) ?? []).length
      return (
        <div className="space-y-3">
          {prompt}
          <div>
            <Label htmlFor={id('fillblank-text')}>{t('library:payloadFields.fillBlankText')}</Label>
            <Textarea id={id('fillblank-text')} value={text} onChange={(event) => set('text', event.target.value)} />
            <p className="mt-1 text-xs text-fg-muted">
              {t('library:payloadFields.blankStats', { placeholders, blanks: blanks.length })}
            </p>
          </div>
          <div>
            <Label htmlFor={id('blanks')}>{t('library:payloadFields.blanks')}</Label>
            <Input
              id={id('blanks')}
              value={blanks.join('; ')}
              onChange={(event) =>
                set('blanks', event.target.value.split(';').map((value) => value.trim()).filter(Boolean))
              }
            />
          </div>
          <div>
            <Label htmlFor={id('wordbank')}>{t('library:payloadFields.wordBank')}</Label>
            <Input
              id={id('wordbank')}
              value={list('wordBank').join('; ')}
              onChange={(event) =>
                set('wordBank', event.target.value.split(';').map((value) => value.trim()).filter(Boolean))
              }
            />
          </div>
        </div>
      )
    }

    case 'matching': {
      const left = list('left')
      const right = list('right')
      const pairs = (payload.pairs as [number, number][] | undefined) ?? []
      return (
        <div className="space-y-3">
          {prompt}
          <div className="grid gap-3 sm:grid-cols-2">
            <ColumnEditor label={t('library:payloadFields.leftColumn')} items={left} onChange={(next) => set('left', next)} />
            <ColumnEditor label={t('library:payloadFields.rightColumn')} items={right} onChange={(next) => set('right', next)} />
          </div>
          <div>
            <Label>{t('library:payloadFields.pairs')}</Label>
            <div className="space-y-2">
              {left.map((item, index) => {
                const pair = pairs.find(([l]) => l === index)
                return (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <span className="w-1/2 truncate text-fg-soft">
                      {index + 1}. {item || t('library:payloadFields.empty')}
                    </span>
                    <Select
                      value={pair ? String(pair[1]) : 'zadne'}
                      onValueChange={(next) => {
                        const without = pairs.filter(([l]) => l !== index)
                        set(
                          'pairs',
                          next === 'zadne'
                            ? without
                            : [...without, [index, Number(next)]].sort((a, b) => a[0] - b[0]),
                        )
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zadne">—</SelectItem>
                        {right.map((option, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {String.fromCharCode(65 + i)}) {option || t('library:payloadFields.empty')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )
    }

    case 'ordering':
      return (
        <div className="space-y-3">
          {prompt}
          <ColumnEditor
            label={t('library:payloadFields.orderingItems')}
            items={list('items')}
            onChange={(next) => set('items', next)}
          />
        </div>
      )

    case 'table_fill': {
      const headers = list('headers')
      const rows = (payload.rows as (string | null)[][] | undefined) ?? []
      const answers = list('answers')
      const blankCount = rows.flat().filter((cell) => cell === null).length
      return (
        <div className="space-y-3">
          {prompt}
          <div>
            <Label htmlFor={id('headers')}>{t('library:payloadFields.headers')}</Label>
            <Input
              id={id('headers')}
              value={headers.join('; ')}
              onChange={(event) => {
                const next = event.target.value.split(';').map((value) => value.trim())
                set('headers', next)
              }}
            />
          </div>
          <div>
            <Label>{t('library:payloadFields.rows')}</Label>
            <div className="space-y-2">
              {rows.map((row, r) => (
                <div key={r} className="flex items-center gap-2">
                  {headers.map((_, c) => (
                    <Input
                      key={c}
                      value={row[c] ?? ''}
                      placeholder={t('library:payloadFields.cellPlaceholder')}
                      onChange={(event) => {
                        const value = event.target.value
                        const nextRow = headers.map((__, i) =>
                          i === c ? (value === '' ? null : value) : (row[i] ?? null),
                        )
                        set('rows', replaceAt(rows, r, nextRow))
                      }}
                    />
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => set('rows', rows.filter((_, i) => i !== r))}>
                    {t('library:payloadFields.remove')}
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => set('rows', [...rows, headers.map(() => null)])}>
              {t('library:payloadFields.addRow')}
            </Button>
          </div>
          <div>
            <Label htmlFor={id('table-answers')}>
              {t('library:payloadFields.tableAnswers')}
            </Label>
            <Input
              id={id('table-answers')}
              value={answers.join('; ')}
              onChange={(event) =>
                set('answers', event.target.value.split(';').map((value) => value.trim()).filter(Boolean))
              }
            />
            <p className="mt-1 text-xs text-fg-muted">
              {t('library:payloadFields.tableStats', { blankCount, answers: answers.length })}
            </p>
          </div>
        </div>
      )
    }

    default:
      return prompt
  }
}

function ColumnEditor({
  label,
  items,
  onChange,
}: {
  label: string
  items: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input value={item} onChange={(event) => onChange(replaceAt(items, index, event.target.value))} />
            <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              {t('library:payloadFields.remove')}
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => onChange([...items, ''])}>
        {t('library:payloadFields.add')}
      </Button>
    </div>
  )
}

function replaceAt<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, i) => (i === index ? value : item))
}
