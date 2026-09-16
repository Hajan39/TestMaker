'use client'

import { useMemo, useState } from 'react'
import { composeRandomTest, randomSeed, type DifficultyChoice } from '@testmaker/core/compose'
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, type Question, type QuestionType } from '@testmaker/core/schema'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  QuestionPreview,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@testmaker/ui'
import type { PickerTopic } from '@/lib/questionPicker'
import { formatPoints } from './types'

/** Co se má stát s osnovou, ve které už něco je. */
export type InsertMode = 'append' | 'replace'

/**
 * Sestavení písemky losem: učitelka zaškrtá témata, řekne kolik a čeho, a
 * aplikace jí test poskládá. Nic se nikam neukládá — výsledek se jen vloží
 * do osnovy, kde jde s položkami dál hýbat, mazat je a přidávat ručně.
 *
 * Samotný výběr dělá `composeRandomTest` z `@testmaker/core/compose`, tahle
 * komponenta je jen zadání a náhled. Losuje se z týchž otázek, jaké nabízí
 * banka, tedy jen ze schválených.
 */
export function RandomDialog({
  topics,
  /** Je v osnově něco rozpracovaného? Podle toho se nabídne přidání nebo nahrazení. */
  hasDraft,
  onInsert,
}: {
  topics: PickerTopic[]
  hasDraft: boolean
  onInsert: (questions: Question[], mode: InsertMode) => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [limitKind, setLimitKind] = useState<'count' | 'points'>('count')
  const [amount, setAmount] = useState(10)
  // `null` = na typu nezáleží; jinak výslovný seznam povolených typů.
  const [types, setTypes] = useState<QuestionType[] | null>(null)
  const [difficulty, setDifficulty] = useState<DifficultyChoice>('mix')
  const [mode, setMode] = useState<InsertMode>('append')
  // Seed drží losování: dokud se nezmění, vyjde tentýž test. „Zamíchat znovu"
  // není nic jiného než nový seed.
  const [seed, setSeed] = useState(() => randomSeed())

  const allQuestions = useMemo(() => topics.flatMap((topic) => topic.questions), [topics])
  const topicName = useMemo(() => new Map(topics.map((topic) => [topic.id, topic.label])), [topics])

  /** Předměty → ročníky → témata, aby šlo zaškrtnout i celý ročník naráz. */
  const tree = useMemo(() => {
    const bySubject = new Map<string, Map<string, PickerTopic[]>>()
    for (const topic of topics) {
      let grades = bySubject.get(topic.subject)
      if (!grades) bySubject.set(topic.subject, (grades = new Map()))
      const list = grades.get(topic.grade)
      if (list) list.push(topic)
      else grades.set(topic.grade, [topic])
    }
    return [...bySubject.entries()].map(([subject, grades]) => ({
      subject,
      grades: [...grades.entries()].map(([grade, list]) => ({ grade, topics: list })),
    }))
  }, [topics])

  /** Typy, které v knihovně vůbec jsou — nabízet prázdné je jen matoucí. */
  const availableTypes = useMemo(() => {
    const present = new Set(allQuestions.map((question) => question.type))
    return QUESTION_TYPES.filter((type) => present.has(type))
  }, [allQuestions])

  const activeTypes = types ?? availableTypes

  const result = useMemo(
    () =>
      composeRandomTest(allQuestions, {
        topicIds: selected,
        limit: limitKind === 'count' ? { kind: 'count', count: amount } : { kind: 'points', points: amount },
        types: activeTypes,
        difficulty,
        // Neschválená otázka se do banky nedostane, tohle je jen pojistka:
        // kdyby se rozsah načítaných otázek někdy rozšířil, los se přes ni nepřenese.
        onlyApproved: true,
        seed,
      }),
    [allQuestions, selected, limitKind, amount, activeTypes, difficulty, seed],
  )

  const selectedSet = new Set(selected)
  const toggleTopics = (ids: string[], add: boolean) =>
    setSelected((current) =>
      add ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)),
    )
  /** Odškrtnout poslední typ nejde — bez jediného typu by nebylo co losovat. */
  const toggleType = (type: QuestionType) =>
    setTypes((current) => {
      const list = current ?? availableTypes
      const next = list.includes(type) ? list.filter((t) => t !== type) : [...list, type]
      return next.length > 0 ? next : list
    })

  function insert() {
    onInsert(result.questions, hasDraft ? mode : 'append')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Sestavit náhodně
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sestavit náhodně</DialogTitle>
          <DialogDescription>
            Zaškrtni témata a řekni, kolik toho má být. Otázky se rozprostřou mezi vybraná témata
            i mezi typy. Vložením do osnovy se nic neukládá — dolaď si je a pak test ulož.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {/* ------------------------------------------------ zadání */}
          <div className="space-y-3">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Témata ({selected.length})</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => toggleTopics(topics.map((topic) => topic.id), true)}
                  >
                    Vybrat vše
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setSelected([])}
                  >
                    Zrušit výběr
                  </Button>
                </div>
              </div>
              <div className="mt-1 max-h-64 space-y-2 overflow-y-auto rounded border border-line-soft p-2">
                {tree.map(({ subject, grades }) => (
                  <div key={subject}>
                    <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{subject}</p>
                    {grades.map(({ grade, topics: list }) => {
                      const ids = list.map((topic) => topic.id)
                      const all = ids.every((id) => selectedSet.has(id))
                      const some = ids.some((id) => selectedSet.has(id))
                      return (
                        <div key={grade} className="mt-1">
                          {/* Celý ročník naráz: čtvrtletky a opakování z loňska
                              se jinak klikají téma po tématu. */}
                          <label className="flex items-center gap-2 text-sm text-fg-soft">
                            <Checkbox
                              checked={all ? true : some ? 'indeterminate' : false}
                              onCheckedChange={() => toggleTopics(ids, !all)}
                              aria-label={`Celý ročník ${grade} (${subject})`}
                            />
                            <span className="font-medium">
                              {grade} <span className="font-normal text-fg-muted">({list.length} témat)</span>
                            </span>
                          </label>
                          <div className="ml-6">
                            {list.map((topic) => (
                              <label key={topic.id} className="flex items-center gap-2 py-0.5 text-sm text-fg-soft">
                                <Checkbox
                                  checked={selectedSet.has(topic.id)}
                                  onCheckedChange={() => toggleTopics([topic.id], !selectedSet.has(topic.id))}
                                  aria-label={topic.name}
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {topic.name}{' '}
                                  <span className="text-fg-muted">({topic.questions.length})</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="w-44">
                <Label htmlFor="random-limit">Rozsah testu</Label>
                <Select
                  value={limitKind}
                  onValueChange={(next) => {
                    setLimitKind(next === 'points' ? 'points' : 'count')
                    setAmount(next === 'points' ? 20 : 10)
                  }}
                >
                  <SelectTrigger id="random-limit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">Počet otázek</SelectItem>
                    <SelectItem value="points">Celkem bodů</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <Label htmlFor="random-amount">{limitKind === 'count' ? 'Otázek' : 'Bodů'}</Label>
                <Input
                  id="random-amount"
                  type="number"
                  min={1}
                  max={200}
                  value={amount}
                  onChange={(event) => setAmount(Math.max(1, Number(event.target.value) || 1))}
                />
              </div>
              <div className="w-40">
                <Label htmlFor="random-difficulty">Obtížnost</Label>
                <Select
                  value={String(difficulty)}
                  onValueChange={(next) => setDifficulty(next === 'mix' ? 'mix' : (Number(next) as 1 | 2 | 3))}
                >
                  <SelectTrigger id="random-difficulty" className="w-full">
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
              <div className="flex flex-wrap items-center gap-3">
                <Label>Typy otázek</Label>
                {/* Zpátky na „všechny“ jedním klikem: naklikat devět typů
                    po jednom je zbytečná práce. */}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setTypes(null)}
                >
                  Všechny
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {availableTypes.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm text-fg-soft">
                    <Checkbox
                      checked={activeTypes.includes(type)}
                      onCheckedChange={() => toggleType(type)}
                      aria-label={QUESTION_TYPE_LABELS[type]}
                    />
                    {QUESTION_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="w-36">
                <Label htmlFor="random-seed">Číslo losování</Label>
                <Input id="random-seed" value={seed} onChange={(event) => setSeed(event.target.value)} />
              </div>
              {/* Losování jde zopakovat: se stejným číslem vyjde týž test. */}
              <Button type="button" variant="outline" onClick={() => setSeed(randomSeed())}>
                Zamíchat znovu
              </Button>
            </div>

            {hasDraft ? (
              <div>
                <Label htmlFor="random-mode">V osnově už něco je</Label>
                <Select value={mode} onValueChange={(next) => setMode(next === 'replace' ? 'replace' : 'append')}>
                  <SelectTrigger id="random-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="append">Přidat vylosované na konec</SelectItem>
                    <SelectItem value="replace">Nahradit celou osnovu</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          {/* ------------------------------------------------ náhled losu */}
          <div className="flex min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">Vylosováno</h3>
              <span className="text-sm text-fg-muted" data-testid="random-summary">
                {result.questions.length} otázek · {formatPoints(result.totalPoints)} b.
              </span>
            </div>

            {result.notes.length > 0 ? (
              <div className="mt-2 space-y-1 rounded bg-draft-bg p-2 text-sm text-draft-fg">
                {result.notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            ) : null}

            {result.questions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {result.topics
                  .filter((share) => share.picked > 0)
                  .map((share) => (
                    <Badge key={share.topicId ?? 'bez-tematu'} variant="secondary">
                      {(share.topicId ? topicName.get(share.topicId) : null) ?? 'Bez tématu'} ·{' '}
                      {share.picked}
                    </Badge>
                  ))}
              </div>
            ) : null}

            <ol className="mt-2 max-h-80 min-h-0 flex-1 list-decimal space-y-2 overflow-y-auto pr-1 pl-5">
              {result.questions.map((question) => (
                <li key={question.id} className="text-sm">
                  <QuestionPreview question={question} showAnswers={false} />
                </li>
              ))}
            </ol>
            {selected.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">
                Zatím není vybrané žádné téma — losuje se ze všech otázek v knihovně.
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Zrušit
          </Button>
          <Button disabled={result.questions.length === 0} onClick={insert}>
            Vložit do osnovy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
