'use client'

import { useMemo, useState } from 'react'
import { composeRandomTest, randomSeed, type DifficultyChoice } from '@testmaker/core/compose'
import { questionTypeLabel, QUESTION_TYPES, type Question, type QuestionType } from '@testmaker/core/schema'
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
import { t } from '@testmaker/core/i18n'
import type { PickerTopic } from '@/lib/questionPicker'
import { formatPoints } from './types'

/** What to do with an outline that already has content. */
export type InsertMode = 'append' | 'replace'

/**
 * Building a test at random: the teacher ticks topics, says how much and of
 * what, and the app composes the test. Nothing is saved — the result is just
 * inserted into the outline, where items can still be moved, deleted and added
 * by hand.
 *
 * The picking itself is `composeRandomTest` from `@testmaker/core/compose`;
 * this component is only the input and preview. It draws from the same
 * questions the bank offers, i.e. approved ones only.
 */
export function RandomDialog({
  topics,
  /** Does the outline have work in progress? Decides whether to offer append or replace. */
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
  // `null` = any type; otherwise an explicit list of allowed types.
  const [types, setTypes] = useState<QuestionType[] | null>(null)
  const [difficulty, setDifficulty] = useState<DifficultyChoice>('mix')
  const [mode, setMode] = useState<InsertMode>('append')
  // The seed pins the draw: until it changes the same test comes out.
  // "Zamíchat znovu" (shuffle again) is nothing but a new seed.
  const [seed, setSeed] = useState(() => randomSeed())

  const allQuestions = useMemo(() => topics.flatMap((topic) => topic.questions), [topics])
  const topicName = useMemo(() => new Map(topics.map((topic) => [topic.id, topic.label])), [topics])

  /** Subjects → grades → topics, so a whole grade can be ticked at once. */
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

  /** Types present in the library at all — offering empty ones only confuses. */
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
        // An unapproved question never reaches the bank; this is just a safeguard
        // in case the loaded question scope ever widens.
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
  /** The last type cannot be unticked — without any type there is nothing to draw. */
  const toggleType = (type: QuestionType) =>
    setTypes((current) => {
      const list = current ?? availableTypes
      const next = list.includes(type) ? list.filter((item) => item !== type) : [...list, type]
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
          {t('tests:random.open')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('tests:random.open')}</DialogTitle>
          <DialogDescription>
            {t('tests:random.intro')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {/* ------------------------------------------------ input */}
          <div className="space-y-3">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>{t('tests:random.topics', { count: selected.length })}</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => toggleTopics(topics.map((topic) => topic.id), true)}
                  >
                    {t('tests:random.selectAll')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setSelected([])}
                  >
                    {t('tests:random.clearSelection')}
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
                          {/* A whole grade at once: quarterly tests and reviews of
                              last year would otherwise be clicked topic by topic. */}
                          <label className="flex items-center gap-2 text-sm text-fg-soft">
                            <Checkbox
                              checked={all ? true : some ? 'indeterminate' : false}
                              onCheckedChange={() => toggleTopics(ids, !all)}
                              aria-label={t('tests:random.wholeGrade', { grade, subject })}
                            />
                            <span className="font-medium">
                              {grade} <span className="font-normal text-fg-muted">({t('tests:random.topicCount', { count: list.length })})</span>
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
                <Label htmlFor="random-limit">{t('tests:random.limit')}</Label>
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
                    <SelectItem value="count">{t('tests:random.limitCount')}</SelectItem>
                    <SelectItem value="points">{t('tests:random.limitPoints')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <Label htmlFor="random-amount">{limitKind === 'count' ? t('tests:random.amountQuestions') : t('tests:random.amountPoints')}</Label>
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
                <Label htmlFor="random-difficulty">{t('tests:random.difficulty')}</Label>
                <Select
                  value={String(difficulty)}
                  onValueChange={(next) => setDifficulty(next === 'mix' ? 'mix' : (Number(next) as 1 | 2 | 3))}
                >
                  <SelectTrigger id="random-difficulty" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mix">{t('tests:random.difficultyMix')}</SelectItem>
                    <SelectItem value="1">{t('tests:random.difficultyEasy')}</SelectItem>
                    <SelectItem value="2">{t('tests:random.difficultyMedium')}</SelectItem>
                    <SelectItem value="3">{t('tests:random.difficultyHard')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-3">
                <Label>{t('tests:random.types')}</Label>
                {/* Back to "all" in one click: ticking nine types one by one
                    is wasted effort. */}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setTypes(null)}
                >
                  {t('tests:random.allTypes')}
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {availableTypes.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm text-fg-soft">
                    <Checkbox
                      checked={activeTypes.includes(type)}
                      onCheckedChange={() => toggleType(type)}
                      aria-label={questionTypeLabel(type)}
                    />
                    {questionTypeLabel(type)}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="w-36">
                <Label htmlFor="random-seed">{t('tests:random.seed')}</Label>
                <Input id="random-seed" value={seed} onChange={(event) => setSeed(event.target.value)} />
              </div>
              {/* The draw is repeatable: the same number gives the same test. */}
              <Button type="button" variant="outline" onClick={() => setSeed(randomSeed())}>
                {t('tests:random.reshuffle')}
              </Button>
            </div>

            {hasDraft ? (
              <div>
                <Label htmlFor="random-mode">{t('tests:random.mode')}</Label>
                <Select value={mode} onValueChange={(next) => setMode(next === 'replace' ? 'replace' : 'append')}>
                  <SelectTrigger id="random-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="append">{t('tests:random.modeAppend')}</SelectItem>
                    <SelectItem value="replace">{t('tests:random.modeReplace')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          {/* ------------------------------------------------ draw preview */}
          <div className="flex min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">{t('tests:random.drawn')}</h3>
              <span className="text-sm text-fg-muted" data-testid="random-summary">
                {t('tests:random.summary', { count: result.questions.length, points: formatPoints(result.totalPoints) })}
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
                      {(share.topicId ? topicName.get(share.topicId) : null) ?? t('tests:random.noTopic')} ·{' '}
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
                {t('tests:random.noTopicSelected')}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button disabled={result.questions.length === 0} onClick={insert}>
            {t('tests:random.insert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
