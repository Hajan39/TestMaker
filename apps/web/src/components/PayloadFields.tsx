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

type Payload = Record<string, unknown>

/** Formulářová pole podle typu otázky. Pracuje nad neotypovaným payloadem, validuje se až zod schématem. */
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

  // Karta v úpravě a „Nová otázka" mohou stát na obrazovce vedle sebe — pevná
  // id by se pak zdvojila a `htmlFor` by mířilo na cizí pole.
  const uid = useId()
  const id = (name: string) => `payload-${name}-${uid}`

  const prompt = (
    <div>
      <Label htmlFor={id('prompt')}>Zadání</Label>
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
              <Label htmlFor={id('lines')}>Počet linek</Label>
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
            <Label htmlFor={id('open-answer')}>Vzorová odpověď (do klíče)</Label>
            <Textarea
              id={id('open-answer')}
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
            <Label htmlFor={id('short-answer')}>Správná odpověď</Label>
            <Input
              id={id('short-answer')}
              value={str('answer')}
              onChange={(event) => set('answer', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={id('accepted-answers')}>Další uznávané odpovědi (oddělené středníkem)</Label>
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
            <Label>Možnosti (zaškrtni správné)</Label>
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
                    Odebrat
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => set('options', [...options, ''])}>
              Přidat možnost
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
            <Label>Tvrzení (zaškrtnuté = pravdivé)</Label>
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
                    Odebrat
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
              Přidat tvrzení
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
            <Label htmlFor={id('fillblank-text')}>Text s vynechávkami — místo k doplnění zapiš jako ___</Label>
            <Textarea id={id('fillblank-text')} value={text} onChange={(event) => set('text', event.target.value)} />
            <p className="mt-1 text-xs text-fg-muted">
              Vynechávek v textu: {placeholders}, doplňovaných výrazů: {blanks.length}
            </p>
          </div>
          <div>
            <Label htmlFor={id('blanks')}>Správné výrazy v pořadí (oddělené středníkem)</Label>
            <Input
              id={id('blanks')}
              value={blanks.join('; ')}
              onChange={(event) =>
                set('blanks', event.target.value.split(';').map((value) => value.trim()).filter(Boolean))
              }
            />
          </div>
          <div>
            <Label htmlFor={id('wordbank')}>Nabídka slov navíc (nepovinné, oddělené středníkem)</Label>
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
            <ColumnEditor label="Levý sloupec" items={left} onChange={(next) => set('left', next)} />
            <ColumnEditor label="Pravý sloupec" items={right} onChange={(next) => set('right', next)} />
          </div>
          <div>
            <Label>Správné dvojice</Label>
            <div className="space-y-2">
              {left.map((item, index) => {
                const pair = pairs.find(([l]) => l === index)
                return (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <span className="w-1/2 truncate text-fg-soft">
                      {index + 1}. {item || '(prázdné)'}
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
                            {String.fromCharCode(65 + i)}) {option || '(prázdné)'}
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
            label="Položky ve správném pořadí (při tisku se zamíchají)"
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
            <Label htmlFor={id('headers')}>Hlavička (oddělená středníkem)</Label>
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
            <Label>Řádky — prázdné pole = buňka k doplnění</Label>
            <div className="space-y-2">
              {rows.map((row, r) => (
                <div key={r} className="flex items-center gap-2">
                  {headers.map((_, c) => (
                    <Input
                      key={c}
                      value={row[c] ?? ''}
                      placeholder="k doplnění"
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
                    Odebrat
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => set('rows', [...rows, headers.map(() => null)])}>
              Přidat řádek
            </Button>
          </div>
          <div>
            <Label htmlFor={id('table-answers')}>
              Správné hodnoty pro prázdné buňky po řádcích (oddělené středníkem)
            </Label>
            <Input
              id={id('table-answers')}
              value={answers.join('; ')}
              onChange={(event) =>
                set('answers', event.target.value.split(';').map((value) => value.trim()).filter(Boolean))
              }
            />
            <p className="mt-1 text-xs text-fg-muted">
              Prázdných buněk: {blankCount}, zadaných hodnot: {answers.length}
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
              Odebrat
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => onChange([...items, ''])}>
        Přidat
      </Button>
    </div>
  )
}

function replaceAt<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, i) => (i === index ? value : item))
}
