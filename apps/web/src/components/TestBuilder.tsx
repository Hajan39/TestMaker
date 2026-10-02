'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Question, QuestionContent, ResolvedTestItem, Template, Test } from '@testmaker/core/schema'
import type { WorksheetItemDraft, WorksheetTarget } from '@testmaker/core/ai'
import {
  Button,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useMatchesMedia,
} from '@testmaker/ui'
import type { Role } from '@/lib/role'
import type { PickerTopic } from '@/lib/questionPicker'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'
import { PrintMenu } from '@/components/PrintMenu'
import { QuestionEditor } from '@/components/QuestionEditor'
import { testPath } from '@/app/tests/paths'
import { emptyTable } from '@/components/test-builder/WorksheetItems'
import { TestVariantMenu } from '@/components/TestVariantMenu'
import { BankPanel } from '@/components/test-builder/BankPanel'
import { TestPage } from '@/components/test-builder/TestPage'
import { RandomDialog, type InsertMode } from '@/components/test-builder/RandomDialog'
import { TestSettings } from '@/components/test-builder/TestSettings'
import {
  nextDraftKey,
  type BankFilters,
  type DraftItem,
  type TestSettingsValue,
  type WorksheetAddKind,
} from '@/components/test-builder/types'
import { defaultTemplateId, emptyHeader } from '@/components/test-builder/defaults'

/** Default text of a newly inserted structural item. */
function structuralText(kind: 'heading' | 'instruction' | 'page_break'): string | null {
  if (kind === 'heading') return t('tests:builder.newSection')
  if (kind === 'instruction') return t('tests:page.instructionField')
  return null
}

/**
 * The test builder. It holds the state; both columns — the question bank on
 * the left and the test page on the right — are controlled components.
 *
 * The page is both preview and workspace: there used to be a rough preview
 * next to a separate outline, so the teacher built in one column and guessed
 * the result from the other.
 */
export function TestBuilder({
  topics,
  templates,
  test,
  items,
  gradeId,
  gradeLabel,
  backTopic,
  role,
  ai,
  dropped = 0,
  mine = true,
}: {
  topics: PickerTopic[]
  templates: Template[]
  test: Test | null
  items: ResolvedTestItem[]
  /** The test's grade (`gradeId` from `loadTest`) — pre-filters the bank. */
  gradeId?: string | null
  /** Grade label for the header, e.g. "Přírodopis · 6. ročník". */
  gradeLabel?: string | null
  /** The topic the test came from (`?tema=`) — only when it belongs to the school. */
  backTopic?: { id: string; name: string } | null
  /** Role of the signed-in user — the preview role must not see test versions at all. */
  role?: Role
  /**
   * Is generation configured (`aiStatus()` from the page)? Without a model no
   * test version can be made — the menu says so instead of buttons that would
   * only fail.
   */
  ai: { configured: boolean; problems: string[] }
  /** How many items the model skipped when generating the worksheet (`?vynechano=`). */
  dropped?: number
  /**
   * Does the test belong to the signed-in user? The server won't let anyone
   * overwrite a colleague's shared test, so it is only read and printed, and a
   * copy is offered for edits.
   */
  mine?: boolean
}) {
  const router = useRouter()
  const readOnly = !mine
  const narrow = useMatchesMedia('(max-width: 1023.98px)')
  // A worksheet is always created from the "Nový pracovní list" form, so it
  // arrives in the editor already saved and its kind comes from the test.
  const worksheet = test?.kind === 'pracovni_list'
  const kind = test?.kind ?? 'pisemka'
  const [settings, setSettings] = useState<TestSettingsValue>(() => ({
    title: test?.title ?? '',
    description: test?.description ?? '',
    graded: test?.graded ?? true,
    templateId: test?.templateId ?? defaultTemplateId(templates),
    header: test?.header ?? emptyHeader(),
    variants: test?.variants ?? 1,
    // The key is no longer set on the test but chosen at print time ("Zadání
    // pro žáky" / "Vyplněná pro mě"). The DB column stays; nothing changes it.
    showKey: test?.showKey ?? true,
    // A test is private by default; it is shared only when the author asks.
    visibility: test?.visibility ?? 'soukrome',
  }))
  const [draft, setDraft] = useState<DraftItem[]>(() =>
    items.map((item) => ({
      key: nextDraftKey(),
      id: item.id,
      kind: item.kind,
      questionId: item.questionId,
      text: item.text,
      pointsOverride: item.pointsOverride,
      linesOverride: item.linesOverride ?? null,
      question: item.question ?? null,
      questionEdited: item.questionEdited,
      questionMissing: item.questionMissing,
      puzzleId: item.puzzleId ?? null,
      puzzle: item.puzzle ?? null,
      table: item.table ?? null,
      textContent: item.textContent ?? null,
      needsCheck: item.needsCheck ?? false,
    })),
  )
  // No status filter here: the server only sends approved questions to the
  // bank, so a draft has no way into a real test.
  //
  // Default grade filter = the test's grade — whoever builds a test for 6. B
  // wants to see 6. B first. Switching to "Všechny třídy" allows picking from
  // other grades, which is how a cross-topic review test is made. A test
  // without a grade (older or created without a topic) offers everything.
  const [filters, setFilters] = useState<BankFilters>({
    search: '',
    subject: '',
    // Pre-filtering to the test's grade only makes sense if the bank has
    // anything from that grade — otherwise the Select would show an empty label
    // over an empty bank and the teacher would not know the filter is to blame.
    grade: gradeId && topics.some((topic) => topic.gradeId === gradeId) ? gradeId : '',
    type: '',
  })
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  // Only the title error — it belongs to the field; other action errors go to toasts.
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(test?.id ?? null)
  // A missing title used to be reported at the bar while the field was hidden
  // in the settings panel. Now the field is in the header and gets focus on error.
  const titleRef = useRef<HTMLInputElement>(null)
  const [titleInvalid, setTitleInvalid] = useState(false)

  /**
   * How many times each question is in the outline. The same question may
   * appear more than once (a warm-up, then again in another part), so it is
   * counted, not just flagged as present.
   */
  const usedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of draft) {
      if (!item.questionId) continue
      counts.set(item.questionId, (counts.get(item.questionId) ?? 0) + 1)
    }
    return counts
  }, [draft])
  const questionCount = draft.filter((item) => item.kind === 'question').length
  const template = templates.find((candidate) => candidate.id === settings.templateId) ?? templates[0] ?? null

  function questionItem(question: Question): DraftItem {
    return {
      key: nextDraftKey(),
      id: null,
      kind: 'question',
      questionId: question.id,
      text: null,
      pointsOverride: null,
      linesOverride: null,
      question,
      puzzleId: null,
      puzzle: null,
      table: null,
      textContent: null,
      needsCheck: false,
    }
  }

  /** Another occurrence of the same question at the end of the outline — others stay. */
  function addQuestion(question: Question) {
    setDraft((current) => [...current, questionItem(question)])
  }

  /** Bank checkbox: either adds the question or removes all its occurrences. */
  function toggleQuestion(question: Question) {
    setDraft((current) =>
      usedCounts.has(question.id)
        ? current.filter((item) => item.questionId !== question.id)
        : [...current, questionItem(question)],
    )
  }

  /**
   * Ticking a whole group. Only questions not yet in the outline are added, so
   * a bulk pick does not duplicate selected ones; removing drops the whole
   * group at once.
   */
  function toggleMany(list: Question[], add: boolean) {
    setDraft((current) => {
      if (!add) {
        const removed = new Set(list.map((question) => question.id))
        return current.filter((item) => !item.questionId || !removed.has(item.questionId))
      }
      const present = new Set(current.map((item) => item.questionId).filter(Boolean) as string[])
      const added = list.filter((question) => !present.has(question.id)).map(questionItem)
      return [...current, ...added]
    })
  }

  /**
   * A drawn test into the outline. Work in progress must not be lost silently:
   * `append` adds the drawn questions at the end, `replace` replaces the whole
   * outline, and the teacher picks in the dialog. Nothing is saved — that is
   * still the Save button's job.
   */
  function insertRandom(questions: Question[], mode: InsertMode) {
    setDraft((current) => {
      const added = questions.map(questionItem)
      return mode === 'replace' ? added : [...current, ...added]
    })
  }

  /**
   * Headings, instructions and page breaks can be inserted anywhere: `index` is
   * where the item goes (0 = very top). Without it, it is appended.
   */
  function addStructural(kind: 'heading' | 'instruction' | 'page_break', index?: number) {
    setDraft((current) => {
      const item: DraftItem = {
        key: nextDraftKey(),
        id: null,
        kind,
        questionId: null,
        text: structuralText(kind),
        pointsOverride: null,
        linesOverride: null,
        question: null,
        puzzleId: null,
        puzzle: null,
        table: null,
        textContent: null,
        needsCheck: false,
      }
      const at = Math.min(Math.max(index ?? current.length, 0), current.length)
      const next = [...current]
      next.splice(at, 0, item)
      return next
    })
  }

  function reorder(from: number, to: number) {
    setDraft((current) => {
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved as DraftItem)
      return next
    })
  }

  function removeItem(key: string) {
    setDraft((current) => current.filter((item) => item.key !== key))
  }

  function patchItem(key: string, patch: Partial<DraftItem>) {
    setDraft((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  // Key of the item whose question is being reloaded from the bank.
  const [reloading, setReloading] = useState<string | null>(null)
  // Bank question opened for editing from the test, with the item it came from.
  const [bankEdit, setBankEdit] = useState<{ key: string; question: Question } | null>(null)

  async function fetchBankQuestion(questionId: string): Promise<Question> {
    const data = await requestJson<{ question: Question }>(
      `/api/questions/${encodeURIComponent(questionId)}`,
      undefined,
      t('tests:page.reloadFailed'),
    )
    if (!data.question) throw new Error(t('tests:page.reloadFailed'))
    return data.question
  }

  /**
   * Opens the bank question for editing — the current bank version, not the
   * frozen one, so saving cannot undo edits made in the bank meanwhile.
   */
  async function editBankQuestion(key: string) {
    const item = draft.find((candidate) => candidate.key === key)
    if (!item?.questionId) return
    setReloading(key)
    try {
      setBankEdit({ key, question: await fetchBankQuestion(item.questionId) })
    } catch (loadError) {
      toast.error(errorMessage(loadError, t('tests:page.reloadFailed')))
    } finally {
      setReloading(null)
    }
  }

  /** After a bank edit every item with that question takes the new version. */
  async function afterBankEdit(questionId: string) {
    setBankEdit(null)
    try {
      const question = await fetchBankQuestion(questionId)
      setDraft((current) =>
        current.map((item) =>
          item.questionId === questionId && item.kind === 'question'
            ? { ...item, question, questionEdited: false, id: null, reloaded: true }
            : item,
        ),
      )
      toast.success(t('tests:page.editedInBank'))
    } catch (reloadError) {
      toast.error(errorMessage(reloadError, t('tests:page.reloadFailed')))
    }
  }

  /**
   * Replaces the frozen question of an item with the current bank version.
   * Only the preview changes here; dropping the item id makes the next save
   * take a fresh snapshot on the server, as for a newly added question.
   */
  async function reloadQuestion(key: string) {
    const item = draft.find((candidate) => candidate.key === key)
    if (!item?.questionId) return
    setReloading(key)
    try {
      const question = await fetchBankQuestion(item.questionId)
      patchItem(key, { question, questionEdited: false, id: null, reloaded: true })
      toast.success(t('tests:page.reloaded'))
    } catch (reloadError) {
      toast.error(errorMessage(reloadError, t('tests:page.reloadFailed')))
    } finally {
      setReloading(null)
    }
  }

  /* --------------------------------------------------- worksheet */

  // Worksheet task editor: `key` of the edited item, or the slot for a new one.
  const [questionDialog, setQuestionDialog] = useState<{ key: string | null; index?: number } | null>(null)
  const [regenerating, setRegenerating] = useState<string | null>(null)

  function insertAt(item: DraftItem, index?: number) {
    setDraft((current) => {
      const at = Math.min(Math.max(index ?? current.length, 0), current.length)
      const next = [...current]
      next.splice(at, 0, item)
      return next
    })
  }

  /** A worksheet task as a question for the preview; bank metadata mean nothing here. */
  function worksheetQuestion(content: QuestionContent): Question {
    return {
      ...content,
      id: nextDraftKey(),
      topicId: null,
      materialId: null,
      source: 'manual',
      status: 'approved',
      createdAt: '',
      variantOf: null,
    } as Question
  }

  const blankItem = (kind: DraftItem['kind']): DraftItem => ({
    key: nextDraftKey(),
    id: null,
    kind,
    questionId: null,
    text: null,
    pointsOverride: null,
    linesOverride: null,
    question: null,
    puzzleId: null,
    puzzle: null,
    table: null,
    textContent: null,
    needsCheck: false,
  })

  function addWorksheetItem(kind: WorksheetAddKind, index?: number) {
    if (kind === 'question') return setQuestionDialog({ key: null, index })
    if (kind === 'table') return insertAt({ ...blankItem('table'), table: emptyTable() }, index)
    insertAt({ ...blankItem('text'), text: '', textContent: { variant: kind } }, index)
  }

  function submitQuestion(content: QuestionContent) {
    if (!questionDialog) return
    if (questionDialog.key) patchItem(questionDialog.key, { question: worksheetQuestion(content) })
    else insertAt({ ...blankItem('question'), question: worksheetQuestion(content) }, questionDialog.index)
    setQuestionDialog(null)
  }

  /** A model item as an editor item; key and id stay the same. */
  function fromModel(item: WorksheetItemDraft, previous: DraftItem): DraftItem {
    const base = { ...blankItem(item.kind), key: previous.key, id: previous.id, needsCheck: item.needsCheck }
    switch (item.kind) {
      case 'heading':
      case 'instruction':
        return { ...base, text: item.text }
      case 'text':
        return { ...base, text: item.text, textContent: item.content }
      case 'table':
        return { ...base, table: item.content }
      case 'question':
        return { ...base, question: worksheetQuestion(item.question) }
    }
  }

  function targetOf(item: DraftItem): WorksheetTarget | null {
    if (item.kind === 'heading' || item.kind === 'instruction' || item.kind === 'table') return { kind: item.kind }
    if (item.kind === 'text') return { kind: item.textContent?.variant ?? 'text' }
    if (item.kind === 'question' && item.question) return { kind: 'question', questionType: item.question.type }
    return null
  }

  /** Item text for the "already on the worksheet" list. */
  function summaryOf(item: DraftItem): string {
    if (item.kind === 'question') return (item.question?.payload as { prompt?: string } | undefined)?.prompt ?? ''
    if (item.kind === 'table') return item.table ? t('worksheets:builder.tableSummary', { columns: item.table.header.join(', ') }) : ''
    return item.text ?? ''
  }

  /**
   * A new version of one item from the model, in the same place. It is not
   * saved by itself — the worksheet is saved with the Save button like after
   * any other edit.
   */
  async function regenerate(key: string) {
    const item = draft.find((candidate) => candidate.key === key)
    const target = item ? targetOf(item) : null
    if (!item || !target || !savedId) return
    setRegenerating(key)
    const failure = t('worksheets:builder.regenerateFailed')
    try {
      const data = await requestJson<{ item: WorksheetItemDraft }>(
        `/api/worksheets/${encodeURIComponent(savedId)}/items/${encodeURIComponent(item.id ?? key)}/regenerate`,
        jsonBody('POST', {
          target,
          existing: draft.filter((other) => other.key !== key).map(summaryOf).filter(Boolean),
        }),
        failure,
      )
      if (!data.item) throw new Error(`${failure} ${t('common:errors.serverTrouble')}`)
      const replacement = fromModel(data.item, item)
      setDraft((current) => current.map((candidate) => (candidate.key === key ? replacement : candidate)))
      // The new version overwrites manual edits too — the original can still be restored.
      toast.success(t('worksheets:builder.regenerated'), {
        duration: 10_000,
        action: {
          label: t('common:actions.undo'),
          onClick: () => setDraft((current) => current.map((candidate) => (candidate.key === key ? item : candidate))),
        },
      })
    } catch (regenerateError) {
      toast.error(errorMessage(regenerateError, failure))
    } finally {
      setRegenerating(null)
    }
  }

  const toCheck = draft.filter((item) => item.needsCheck).length

  /** Fingerprint of what is actually saved — comparing it reveals unsaved changes. */
  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        settings,
        items: draft.map((item) => ({
          kind: item.kind,
          questionId: item.questionId,
          puzzleId: item.puzzleId,
          text: item.text,
          pointsOverride: item.pointsOverride,
          linesOverride: item.linesOverride,
          table: item.table,
          textContent: item.textContent,
          needsCheck: item.needsCheck,
          // A reloaded question changes what prints even though nothing else did.
          reloaded: item.reloaded ?? false,
          // A worksheet task lives only in its item — editing it changes the worksheet.
          question: worksheet && !item.questionId ? item.question : null,
        })),
      }),
    [settings, draft, worksheet],
  )
  // Fingerprint of the last saved state. In state, not a ref — refs must not be
  // read during render and React warns about it.
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(test ? fingerprint : null)
  // A shared test cannot be saved, so there is nothing to lose.
  const dirty = !readOnly && savedFingerprint !== fingerprint

  // Closing the window with unsaved work used to lose it all without warning.
  // In-app links (back to the topic, main menu) don't close the window and
  // `beforeunload` misses them — so clicks on them are confirmed separately.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href^="/"]') : null
      if (!link || link.getAttribute('target') === '_blank') return
      if (window.confirm(t('common:leaveConfirm'))) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', leave, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', leave, true)
    }
  }, [dirty])

  /** Copy of a shared test — which the author then edits her own way. */
  async function copy() {
    if (!savedId) return
    setCopying(true)
    const failure = t('tests:row.copyFailed')
    try {
      const data = await requestJson<{ id: string }>(
        `/api/tests?copyOf=${encodeURIComponent(savedId)}`,
        { method: 'POST' },
        failure,
      )
      if (!data.id) throw new Error(`${failure} ${t('common:errors.serverTrouble')}`)
      toast.success(t('tests:builder.copied'))
      router.push(testPath(kind, data.id))
    } catch (copyError) {
      toast.error(errorMessage(copyError, failure))
      setCopying(false)
    }
  }

  async function save() {
    setError(null)
    setTitleInvalid(false)
    if (!settings.title.trim()) {
      setTitleInvalid(true)
      titleRef.current?.focus()
      return setError(worksheet ? t('worksheets:builder.titleRequired') : t('tests:builder.titleRequired'))
    }
    if (worksheet) {
      if (draft.length === 0) return void toast.error(t('worksheets:builder.itemRequired'))
    } else if (questionCount === 0) return void toast.error(t('tests:builder.questionRequired'))

    setSaving(true)
    const body = {
      ...(savedId ? { id: savedId } : {}),
      title: settings.title.trim(),
      description: settings.description.trim() || null,
      graded: settings.graded,
      templateId: settings.templateId,
      // The test's grade is not changed in the editor — it is only carried so the
      // first save (POST or PUT) does not clear it by omitting the field.
      gradeId: gradeId ?? null,
      header: settings.header,
      variants: settings.variants,
      showKey: settings.showKey,
      visibility: settings.visibility,
      items: draft.map((item) => ({
        id: item.id,
        kind: item.kind,
        questionId: item.questionId,
        // A puzzle is added to a test from the Puzzles screen; here it is only
        // carried along so re-saving the outline does not delete it.
        puzzleId: item.puzzleId,
        text: item.text,
        pointsOverride: item.pointsOverride,
        linesOverride: item.linesOverride,
        content: item.kind === 'table' ? item.table : item.kind === 'text' ? item.textContent : undefined,
        needsCheck: item.needsCheck,
        // A worksheet task is not in the bank — its content goes with the item snapshot.
        question: worksheet && item.kind === 'question' && !item.questionId ? item.question : null,
      })),
    }

    const failure = worksheet ? t('worksheets:builder.saveFailed') : t('tests:builder.saveFailed')
    try {
      const result = await requestJson<{ id: string; itemIds: string[] }>(
        '/api/tests',
        jsonBody(savedId ? 'PUT' : 'POST', body),
        failure,
      )
      const id = result.id
      if (!id) throw new Error(`${failure} ${t('common:errors.serverTrouble')}`)
      // Without ids from the save the next save would not recognise the items
      // and their frozen snapshots would be retaken from the current bank.
      const itemIds = result.itemIds
      if (itemIds) setDraft((current) => current.map((item, index) => ({ ...item, id: itemIds[index] ?? item.id })))
      setSavedFingerprint(fingerprint)
      setSavedId(id)
      toast.success(t('common:status.saved'))
      // `?vynechano=` only belongs to a freshly generated worksheet — after a save
      // the skipped-items notice would linger, so the URL drops it.
      if (!test || dropped > 0) router.replace(testPath(kind, id))
      else router.refresh()
    } catch (saveError) {
      toast.error(errorMessage(saveError, failure))
    } finally {
      setSaving(false)
    }
  }

  const bank = (
    <BankPanel
      topics={topics}
      filters={filters}
      onFiltersChange={setFilters}
      usedCounts={usedCounts}
      onToggle={toggleQuestion}
      onAddAgain={addQuestion}
      onToggleMany={toggleMany}
    />
  )
  const sheet = (
    <TestPage
      items={draft}
      title={settings.title}
      description={settings.description}
      header={settings.header}
      graded={settings.graded}
      template={template}
      onReorder={reorder}
      onRemove={removeItem}
      onPatch={patchItem}
      onAdd={addStructural}
      onReloadQuestion={readOnly || worksheet ? undefined : (key) => void reloadQuestion(key)}
      onEditBankQuestion={readOnly || worksheet || role === 'nahled' ? undefined : (key) => void editBankQuestion(key)}
      reloading={reloading}
      worksheet={
        worksheet
          ? {
              onAdd: addWorksheetItem,
              onEditQuestion: (key) => setQuestionDialog({ key }),
              // Regenerating needs a configured model and a saved worksheet (its
              // brief is on the server); the preview role changes nothing.
              onRegenerate: ai.configured && savedId && role !== 'nahled' ? (key) => void regenerate(key) : undefined,
              regenerating,
            }
          : undefined
      }
    />
  )
  const editedQuestion = questionDialog?.key
    ? (draft.find((item) => item.key === questionDialog.key)?.question ?? null)
    : null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* The title is not just another setting: without it the test can't be
            saved, so it belongs in plain sight in the header, not in a panel. */}
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="ui-page-title">
            {worksheet ? t('worksheets:builder.editTitle') : test ? t('tests:builder.editTitle') : t('tests:builder.newTitle')}
          </h1>
          {gradeLabel || backTopic ? (
            <p className="mt-1 text-sm text-fg-muted">
              {gradeLabel}
              {gradeLabel && backTopic ? ' · ' : null}
              {backTopic ? (
                <Link href={`/topics/${backTopic.id}`} className="underline hover:no-underline">
                  {t('tests:builder.backToTopic', { topic: backTopic.name })}
                </Link>
              ) : null}
            </p>
          ) : null}
          <div className="mt-2 max-w-md">
            <Label htmlFor="test-title">{worksheet ? t('worksheets:builder.titleLabel') : t('tests:builder.titleLabel')}</Label>
            <Input
              id="test-title"
              ref={titleRef}
              value={settings.title}
              maxLength={200}
              readOnly={readOnly}
              placeholder={worksheet ? t('worksheets:builder.titlePlaceholder') : t('tests:builder.titlePlaceholder')}
              aria-invalid={titleInvalid || undefined}
              aria-describedby={titleInvalid ? 'test-title-error' : undefined}
              onChange={(event) => {
                setTitleInvalid(false)
                setSettings({ ...settings, title: event.target.value })
              }}
            />
          </div>
        </div>
        {/* Counts (questions, points, page estimate) are read in one place only —
            the footer under the test page where they arise. The top bar used to
            repeat them and both numbers had to be kept from contradicting. */}
        <div className="flex flex-wrap items-center gap-2">
          {savedId ? <PrintMenu testId={savedId} variants={settings.variants} dirty={dirty} /> : null}
          {readOnly ? (
            <Button disabled={copying} aria-busy={copying || undefined} onClick={() => void copy()}>
              {copying ? t('tests:row.copying') : t('tests:row.copy')}
            </Button>
          ) : null}
          {/* A test version is made from the saved state — without a saved test
              (new test, preview role) the button has nothing to do. */}
          {savedId && role !== 'nahled' && !worksheet && !readOnly ? (
            <TestVariantMenu
              testId={savedId}
              ai={ai}
              dirty={dirty}
              onDirty={() => toast.error(t('tests:builder.saveBeforeVariant'))}
            />
          ) : null}
          {/* Random draw and bank belong to a written test — worksheet tasks don't come from the bank. */}
          {readOnly ? null : (
            <>
              {worksheet ? null : <RandomDialog topics={topics} hasDraft={draft.length > 0} onInsert={insertRandom} />}
              <TestSettings value={settings} templates={templates} onChange={setSettings} worksheet={worksheet} />
              {dirty ? (
                <span className="text-sm text-fg-muted" role="status">
                  {t('common:status.unsavedChanges')}
                </span>
              ) : null}
              <Button disabled={saving} onClick={() => void save()}>{saving ? t('common:actions.saving') : t('common:actions.save')}</Button>
            </>
          )}
        </div>
      </div>

      {readOnly ? (
        <p className="rounded-[var(--radius-inner)] bg-surface-muted px-3 py-2 text-sm text-fg-soft">
          {t('tests:builder.sharedReadOnly')}
        </p>
      ) : null}

      {error ? (
        <p id="test-title-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {worksheet && dropped > 0 ? (
        <p className="text-sm text-fg-muted">
          {t('worksheets:builder.dropped', { count: dropped })}
        </p>
      ) : null}
      {worksheet && toCheck > 0 ? (
        // A subtle notice; it does not block printing.
        <p className="rounded-[var(--radius-inner)] bg-draft-bg px-3 py-2 text-sm text-draft-fg" data-slot="ke-kontrole">
          {t('worksheets:builder.toCheck', { count: toCheck })}
        </p>
      ) : null}

      {questionDialog ? (
        <QuestionEditor
          topicId=""
          question={editedQuestion}
          title={editedQuestion ? t('worksheets:builder.editTask') : t('worksheets:builder.newTask')}
          onClose={() => setQuestionDialog(null)}
          onSaved={() => setQuestionDialog(null)}
          onSubmit={submitQuestion}
        />
      ) : null}

      {bankEdit ? (
        <QuestionEditor
          topicId={bankEdit.question.topicId ?? ''}
          question={bankEdit.question}
          title={t('tests:page.editInBankTitle')}
          onClose={() => setBankEdit(null)}
          onSaved={() => void afterBankEdit(bankEdit.question.id)}
        />
      ) : null}

      {/* Only one layout is rendered. Both at once (one hidden) meant duplicate
          filter `id`s and a duplicate "Vybrat vše" checkbox. */}
      {readOnly ? (
        // A shared test is view-only: the bank would be useless and
        // `fieldset disabled` turns off all page controls at once.
        <fieldset disabled className="contents">
          <div className="h-[75vh]">{sheet}</div>
        </fieldset>
      ) : worksheet ? (
        // A worksheet has no bank — the page gets the full width.
        <div className="h-[75vh]">{sheet}</div>
      ) : narrow ? (
        // Below 1024 px: one column with tabs.
        <Tabs defaultValue="banka">
          <TabsList>
            <TabsTrigger value="banka">{t('tests:builder.tabBank')}</TabsTrigger>
            <TabsTrigger value="stranka">{t('tests:page.title')}</TabsTrigger>
          </TabsList>
          <TabsContent value="banka"><div className="h-[70vh]">{bank}</div></TabsContent>
          <TabsContent value="stranka"><div className="h-[70vh]">{sheet}</div></TabsContent>
        </Tabs>
      ) : (
        // From 1024 px side by side: bank left, page right. The page gets more
        // room — it shows how the test prints and is where the work happens.
        <div className="grid h-[70vh] gap-4 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="min-h-0">{bank}</div>
          <div className="min-h-0">{sheet}</div>
        </div>
      )}
    </div>
  )
}
