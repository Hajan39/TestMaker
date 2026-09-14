'use client'

import type { QuestionType } from '@testmaker/core/schema'
import { Button, Checkbox, Input, Label, Select, Textarea } from '@testmaker/ui'

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

  const prompt = (
    <div>
      <Label>Zadání</Label>
      <Textarea value={str('prompt')} onChange={(event) => set('prompt', event.target.value)} />
    </div>
  )

  switch (type) {
    case 'open':
      return (
        <div className="space-y-3">
          {prompt}
          <div className="flex gap-3">
            <div className="w-32">
              <Label>Počet linek</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={Number(payload.lines ?? 4)}
                onChange={(event) => set('lines', Number(event.target.value) || 1)}
              />
            </div>
          </div>
          <div>
            <Label>Vzorová odpověď (do klíče)</Label>
            <Textarea value={str('answer')} onChange={(event) => set('answer', event.target.value)} />
          </div>
        </div>
      )

    case 'short_answer':
      return (
        <div className="space-y-3">
          {prompt}
          <div>
            <Label>Správná odpověď</Label>
            <Input value={str('answer')} onChange={(event) => set('answer', event.target.value)} />
          </div>
          <div>
            <Label>Další uznávané odpovědi (oddělené středníkem)</Label>
            <Input
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
                  <Checkbox checked={correctIndices.includes(index)} onChange={() => toggleCorrect(index)} />
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
            <Button size="sm" className="mt-2" onClick={() => set('options', [...options, ''])}>
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
                    onChange={() =>
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
            <Label>Text s vynechávkami — místo k doplnění zapiš jako ___</Label>
            <Textarea value={text} onChange={(event) => set('text', event.target.value)} />
            <p className="mt-1 text-xs text-ink-500">
              Vynechávek v textu: {placeholders}, doplňovaných výrazů: {blanks.length}
            </p>
          </div>
          <div>
            <Label>Správné výrazy v pořadí (oddělené středníkem)</Label>
            <Input
              value={blanks.join('; ')}
              onChange={(event) =>
                set('blanks', event.target.value.split(';').map((value) => value.trim()).filter(Boolean))
              }
            />
          </div>
          <div>
            <Label>Nabídka slov navíc (nepovinné, oddělené středníkem)</Label>
            <Input
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
                    <span className="w-1/2 truncate text-ink-700">
                      {index + 1}. {item || '(prázdné)'}
                    </span>
                    <Select
                      value={String(pair?.[1] ?? '')}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        const without = pairs.filter(([l]) => l !== index)
                        set(
                          'pairs',
                          Number.isNaN(value) ? without : [...without, [index, value]].sort((a, b) => a[0] - b[0]),
                        )
                      }}
                    >
                      <option value="">—</option>
                      {right.map((option, i) => (
                        <option key={i} value={i}>
                          {String.fromCharCode(65 + i)}) {option || '(prázdné)'}
                        </option>
                      ))}
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
            <Label>Hlavička (oddělená středníkem)</Label>
            <Input
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
            <Button size="sm" className="mt-2" onClick={() => set('rows', [...rows, headers.map(() => null)])}>
              Přidat řádek
            </Button>
          </div>
          <div>
            <Label>Správné hodnoty pro prázdné buňky po řádcích (oddělené středníkem)</Label>
            <Input
              value={answers.join('; ')}
              onChange={(event) =>
                set('answers', event.target.value.split(';').map((value) => value.trim()).filter(Boolean))
              }
            />
            <p className="mt-1 text-xs text-ink-500">
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
      <Button size="sm" className="mt-2" onClick={() => onChange([...items, ''])}>
        Přidat
      </Button>
    </div>
  )
}

function replaceAt<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, i) => (i === index ? value : item))
}
