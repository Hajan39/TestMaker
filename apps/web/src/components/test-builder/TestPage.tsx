'use client'

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { paginate } from '@testmaker/core/pdf/estimate'
import { formatAnswer, questionLabel } from '@testmaker/core/pdf/layout'
import { itemQuestion, resolveQuestionStyle, type ResolvedTestItem, type Template, type TestHeaderConfig } from '@testmaker/core/schema'
import { Fragment, useId, useMemo, useState } from 'react'
import {
  Checkbox,
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  PaperHeader,
  PaperPuzzle,
  PaperQuestion,
  PaperSheet,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { formatPoints, type DraftItem, type WorksheetControls } from './types'
import { TableItemEditor, TextItemEditor } from './WorksheetItems'

/**
 * The test page — preview and content of the test in one surface.
 *
 * It used to be two things: one column built the outline (a list of rows) and
 * the other showed a rough preview the teacher had to extrapolate from to
 * guess the printed result. Here the test is built right on sheets that look
 * like the final print: questions are drawn by `PaperQuestion` from
 * `packages/ui` (the same model as the PDF) and pages break via `paginate`,
 * i.e. where the real PDF breaks.
 *
 * The paper only shows what pupils get — the key is never drawn on it. A
 * sample answer can be revealed per question with the "Řešení" button in the
 * margin controls; it shows off the paper, noting that it is not printed.
 */
export function TestPage({
  items,
  title,
  description,
  header,
  graded,
  template,
  onReorder,
  onRemove,
  onPatch,
  onAdd,
  onReloadQuestion,
  onEditBankQuestion,
  reloading = null,
  worksheet,
}: {
  items: DraftItem[]
  title: string
  description: string
  header: TestHeaderConfig
  graded: boolean
  /** Without a template it is unknown how the page prints — the surface stays empty. */
  template: Template | null
  onReorder: (from: number, to: number) => void
  onRemove: (key: string) => void
  onPatch: (key: string, patch: Partial<DraftItem>) => void
  /** `index` is where the item goes (0 = very top); without it, at the end. */
  onAdd: (kind: 'heading' | 'instruction' | 'page_break', index?: number) => void
  /** Reloads an edited question from the bank; absent where the test cannot be changed. */
  onReloadQuestion?: (key: string) => void
  /** Opens the bank question of an item for editing; absent where the bank cannot be changed. */
  onEditBankQuestion?: (key: string) => void
  /** Key of the item currently being reloaded. */
  reloading?: string | null
  /** Worksheet controls; absent for a written test. */
  worksheet?: WorksheetControls
}) {
  // Which questions have their solution revealed. The state belongs here, not
  // in the item: it is not saved with the test and nobody misses it later.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const questionCount = items.filter((item) => item.kind === 'question').length
  const totalPoints = items.reduce(
    (sum, item) => (item.kind === 'question' ? sum + (item.pointsOverride ?? item.question?.points ?? 0) : sum),
    0,
  )

  /** Items in the shape the PDF renderer and pagination read. */
  const resolved = useMemo<ResolvedTestItem[]>(
    () =>
      items.map((item, index) => ({
        id: item.key,
        testId: 'draft',
        order: index,
        kind: item.kind,
        questionId: item.questionId,
        text: item.text,
        pointsOverride: item.pointsOverride,
        linesOverride: item.linesOverride,
        wordBankHidden: item.wordBankHidden,
        question: item.question,
        // Without the puzzle content the estimate would give it zero height and
        // the preview would have fewer pages than the PDF.
        puzzleId: item.puzzleId,
        puzzle: item.puzzle,
        table: item.table,
        textContent: item.textContent,
      })),
    [items],
  )

  /**
   * Splitting into pages. `paginate` does not return page breaks in the pages
   * (it only breaks on them), so items are split by its result while walking
   * the original order — otherwise a page break would vanish from the page and
   * could not be removed or moved.
   */
  const pages = useMemo(() => {
    // Title and description belong in the first-page header; the estimate
    // uses them to recognise a puzzle that does not repeat its own title.
    const broken = template ? paginate(resolved, template.config, { title, description }) : [resolved]
    const pageOfKey = new Map<string, number>()
    broken.forEach((page, index) => page.forEach((item) => pageOfKey.set(item.id, index)))

    const groups: { item: DraftItem; index: number; number: number | null }[][] = broken.map(() => [])
    let current = 0
    let questionNumber = -1
    items.forEach((item, index) => {
      // A page break belongs at the end of the page it ends.
      const page = item.kind === 'page_break' ? current : (pageOfKey.get(item.key) ?? current)
      current = page
      if (item.kind === 'question') questionNumber += 1
      groups[page]?.push({ item, index, number: item.kind === 'question' ? questionNumber : null })
    })
    return groups
  }, [items, resolved, template, title, description])

  /**
   * The same question may appear in a test several times. To tell the
   * occurrences apart, repeated questions get a usage number.
   */
  const repeats = useMemo(() => {
    const total = new Map<string, number>()
    for (const item of items) {
      if (item.questionId) total.set(item.questionId, (total.get(item.questionId) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    const labels = new Map<string, string>()
    for (const item of items) {
      if (!item.questionId || (total.get(item.questionId) ?? 0) < 2) continue
      const order = (seen.get(item.questionId) ?? 0) + 1
      seen.set(item.questionId, order)
      labels.set(item.key, t('tests:page.usage', { order }))
    }
    return labels
  }, [items])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // Without `id`, dnd-kit numbers `aria-describedby` with a counter that runs
  // differently on server and client — the page then reports a hydration mismatch.
  const dndId = useId()

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((item) => item.key === active.id)
    const to = items.findIndex((item) => item.key === over.id)
    if (from === -1 || to === -1) return
    onReorder(from, to)
  }

  function toggleAnswer(key: string) {
    setRevealed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  return (
    <Card className="surface-content flex h-full flex-col gap-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{t('tests:page.title')}</h2>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => onAdd('heading')}>
            {t('tests:page.addHeading')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdd('instruction')}>
            {t('tests:page.addInstruction')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdd('page_break')}>
            {t('tests:page.addPageBreak')}
          </Button>
          {worksheet ? (
            <>
              <Button size="sm" variant="outline" onClick={() => worksheet.onAdd('text')}>
                {t('tests:page.addText')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => worksheet.onAdd('fun_fact')}>
                {t('tests:page.addFunFact')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => worksheet.onAdd('table')}>
                {t('tests:page.addTable')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => worksheet.onAdd('question')}>
                {t('tests:page.addTask')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {template ? (
        // A worksheet lies on its own colour, so it is never mistaken for a test.
        <div
          className={
            'mt-3 min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-outer)] p-3 ' +
            (worksheet ? 'bg-worksheet-bg' : 'bg-surface-muted')
          }
        >
          <DndContext
            id={dndId}
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((item) => item.key)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {pages.map((page, pageIndex) => (
                  <PaperSheet
                    key={pageIndex}
                    config={template.config}
                    footerLeft={title || t('tests:page.untitled')}
                    footerRight={t('tests:page.footer', { page: pageIndex + 1, pages: pages.length })}
                  >
                    {pageIndex === 0 ? (
                      <PaperHeader
                        title={title}
                        description={description}
                        header={header}
                        config={template.config}
                        graded={graded}
                        totalPoints={totalPoints}
                      />
                    ) : null}
                    {pageIndex === 0 && items.length === 0 ? (
                      <p className="mt-6 text-center text-sm text-paper-fg opacity-60">
                        {worksheet
                          ? t('tests:page.emptyWorksheet')
                          : t('tests:page.emptyTest')}
                      </p>
                    ) : null}
                    <ol>
                      {page.map(({ item, index, number }) => (
                        <Fragment key={item.key}>
                          <InsertSlot index={index} total={items.length} onAdd={onAdd} worksheet={worksheet} />
                          <PageRow
                            item={item}
                            number={number}
                            graded={graded}
                            template={template}
                            repeatLabel={repeats.get(item.key) ?? null}
                            revealed={revealed.has(item.key)}
                            onToggleAnswer={toggleAnswer}
                            onRemove={onRemove}
                            onPatch={onPatch}
                            onReloadQuestion={onReloadQuestion}
                            onEditBankQuestion={onEditBankQuestion}
                            reloading={reloading === item.key}
                            worksheet={worksheet}
                          />
                        </Fragment>
                      ))}
                      {pageIndex === pages.length - 1 ? (
                        <InsertSlot index={items.length} total={items.length} onAdd={onAdd} worksheet={worksheet} />
                      ) : null}
                    </ol>
                  </PaperSheet>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">
          {t('tests:page.noTemplate')}
        </p>
      )}

      {items.length > 0 ? (
        <dl className="mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-line-soft pt-2 text-sm text-fg-muted">
          <div
            data-testid="test-question-count"
            data-count={worksheet ? items.filter((item) => item.kind !== 'page_break').length : questionCount}
          >
            <dt className="inline text-fg-soft">{worksheet ? t('tests:page.itemCount') : t('tests:page.questionCount')}</dt>
            <dd className="ui-numeric inline">
              {worksheet ? items.filter((item) => item.kind !== 'page_break').length : questionCount}
            </dd>
          </div>
          {graded ? (
            <div>
              <dt className="inline text-fg-soft">{t('tests:page.points')}</dt>
              <dd className="ui-numeric inline">{formatPoints(totalPoints)}</dd>
            </div>
          ) : null}
          {template ? (
            <div>
              <dt className="inline text-fg-soft">{t('tests:page.pageEstimate')}</dt>
              <dd className="ui-numeric inline">{pages.length}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </Card>
  )
}

/**
 * A slot between items to insert a heading, an instruction or a page break.
 * It is a plain button with a menu, so the keyboard reaches it too — mouse
 * dragging (dnd-kit) stays untouched.
 */
function InsertSlot({
  index,
  total,
  onAdd,
  worksheet,
}: {
  index: number
  total: number
  onAdd: (kind: 'heading' | 'instruction' | 'page_break', index?: number) => void
  worksheet?: WorksheetControls
}) {
  const label = index === total ? t('tests:page.insertAtEnd') : t('tests:page.insertBefore', { position: index + 1 })
  return (
    <li className="group/slot flex list-none items-center gap-2 py-0.5">
      <span aria-hidden="true" className="h-px flex-1 bg-paper-line opacity-0 transition-opacity group-hover/slot:opacity-100" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-2 text-xs text-fg-muted opacity-35 transition-opacity hover:bg-surface hover:opacity-100 focus-visible:opacity-100 group-hover/slot:opacity-100"
            aria-label={label}
            title={t('tests:page.insertTitle', { label })}
          >
            +
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onSelect={() => onAdd('heading', index)}>{t('tests:page.heading')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAdd('instruction', index)}>{t('tests:page.instruction')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAdd('page_break', index)}>{t('tests:page.pageBreak')}</DropdownMenuItem>
          {worksheet ? (
            <>
              <DropdownMenuItem onSelect={() => worksheet.onAdd('text', index)}>{t('tests:page.text')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => worksheet.onAdd('fun_fact', index)}>{t('tests:page.funFact')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => worksheet.onAdd('table', index)}>{t('tests:page.table')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => worksheet.onAdd('question', index)}>{t('tests:page.task')}</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-hidden="true" className="h-px flex-1 bg-paper-line opacity-0 transition-opacity group-hover/slot:opacity-100" />
    </li>
  )
}

/**
 * One item on the page. It renders like the print; the controls (handle,
 * points, lines, solution, remove) appear at the margin only on hover or
 * focus — otherwise the page would look like a form. The transparent
 * controls stay in the tab order, so they are reachable from the keyboard.
 */
function PageRow({
  item,
  number,
  graded,
  template,
  repeatLabel,
  revealed,
  onToggleAnswer,
  onRemove,
  onPatch,
  onReloadQuestion,
  onEditBankQuestion,
  reloading,
  worksheet,
}: {
  worksheet?: WorksheetControls
  item: DraftItem
  /** Question position in the test (zero-based); `null` for other items. */
  number: number | null
  graded: boolean
  template: Template
  repeatLabel: string | null
  revealed: boolean
  onToggleAnswer: (key: string) => void
  onRemove: (key: string) => void
  onPatch: (key: string, patch: Partial<DraftItem>) => void
  onReloadQuestion?: (key: string) => void
  onEditBankQuestion?: (key: string) => void
  reloading: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key })
  // A worksheet task never lives in the bank — "no longer in the bank" means nothing there.
  const missing = Boolean(item.questionMissing) && !worksheet
  const config = template.config
  const question = item.question
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const pt = (value: number) => `calc(${value} * var(--paper-pt, 1.3333px))`

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group/row relative list-none rounded-[var(--radius-inner)] outline-offset-4 hover:outline hover:outline-line focus-within:outline focus-within:outline-line"
    >
      {/* Margin controls. They stay in the keyboard flow even when invisible. */}
      <div className="absolute -top-3 right-0 z-10 flex items-center gap-1 rounded-[var(--radius-inner)] border border-line bg-surface px-1 py-0.5 text-fg opacity-0 shadow-sm transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          className="cursor-grab touch-none px-1 text-fg-muted active:cursor-grabbing"
          aria-label={t('tests:page.drag')}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        {item.kind === 'question' && graded ? (
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            {t('tests:page.pointsShort')}
            <Input
              className="h-6 w-14 px-1 text-xs"
              type="number"
              min={0}
              step={0.5}
              aria-label={t('tests:page.questionPoints')}
              value={item.pointsOverride ?? question?.points ?? 0}
              onChange={(event) => onPatch(item.key, { pointsOverride: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
        ) : null}
        {/* How much room a pupil needs depends on the test, not the question —
            so the line count is set here, not on the bank question. */}
        {item.kind === 'question' && (question?.type === 'open' || question?.type === 'draw') ? (
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            {t('tests:page.lines')}
            <Input
              className="h-6 w-14 px-1 text-xs"
              type="number"
              min={1}
              max={30}
              step={1}
              aria-label={t('tests:page.answerLines')}
              value={item.linesOverride ?? (question.payload as { lines?: number }).lines ?? (question.type === 'draw' ? 8 : 4)}
              onChange={(event) => onPatch(item.key, { linesOverride: Math.max(1, Number(event.target.value) || 1) })}
            />
          </label>
        ) : null}
        {item.kind === 'question' && question?.type === 'fill_blank' && question.payload.wordBank.length > 0 ? (
          // Whether the pupils get the words on offer depends on the test, not the question.
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            <Checkbox
              className="size-3.5"
              checked={!item.wordBankHidden}
              onCheckedChange={(checked) => onPatch(item.key, { wordBankHidden: checked !== true })}
            />
            {t('tests:page.wordBank')}
          </label>
        ) : null}
        {item.kind === 'question' && question ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            aria-pressed={revealed}
            onClick={() => onToggleAnswer(item.key)}
          >
            {t('tests:page.solution')}
          </Button>
        ) : null}
        {worksheet && item.kind === 'question' ? (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => worksheet.onEditQuestion(item.key)}>
            {t('common:actions.edit')}
          </Button>
        ) : onEditBankQuestion && item.kind === 'question' && item.questionId && !item.questionMissing ? (
          // Edits the question in the bank — the test then takes the new version.
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={reloading}
            onClick={() => onEditBankQuestion(item.key)}
          >
            {t('common:actions.edit')}
          </Button>
        ) : null}
        {worksheet?.onRegenerate && item.kind !== 'page_break' ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={worksheet.regenerating !== null}
            aria-busy={worksheet.regenerating === item.key || undefined}
            onClick={() => worksheet.onRegenerate?.(item.key)}
          >
            {worksheet.regenerating === item.key ? t('tests:page.regenerating') : t('tests:page.regenerate')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onRemove(item.key)}>
          {t('tests:page.remove')}
        </Button>
      </div>

      {item.needsCheck ? (
        // The "ověř" flag is not printed. It is cleared only by a click — editing
        // the text does not clear it, since fixing one word does not mean the
        // content was verified.
        <div className="pt-2">
          <button
            type="button"
            className="rounded-[var(--radius-tag)] bg-draft-bg px-1.5 py-0.5 text-xs font-medium text-draft-fg hover:underline"
            title={t('tests:page.verifyTitle')}
            aria-label={t('tests:page.verifyLabel')}
            onClick={() => onPatch(item.key, { needsCheck: false })}
          >
            {t('tests:page.verify')}
          </button>
        </div>
      ) : null}

      {repeatLabel || missing || item.questionEdited ? (
        <div className="flex flex-wrap items-center gap-1 pt-2">
          {repeatLabel ? <Badge variant="secondary">{repeatLabel}</Badge> : null}
          {/* The test keeps the question content frozen at the moment it was
              added, so a printed test cannot change through later edits to the
              question. If the bank has drifted since, it shows here. */}
          {missing ? (
            <Badge className="bg-draft-bg text-draft-fg" data-testid="question-missing-badge">
              {t('tests:page.questionMissing')}
            </Badge>
          ) : item.questionEdited ? (
            <>
              <Badge className="bg-draft-bg text-draft-fg" data-testid="question-edited-badge">
                {t('tests:page.questionEdited')}
              </Badge>
              {onReloadQuestion ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs text-fg"
                  disabled={reloading}
                  aria-busy={reloading || undefined}
                  onClick={() => onReloadQuestion(item.key)}
                >
                  {reloading ? t('tests:page.reloadingQuestion') : t('tests:page.reloadQuestion')}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {item.kind === 'question' && question ? (
        <>
          <PaperQuestion
            question={itemQuestion(question, item)}
            label={number === null ? undefined : questionLabel(number, config.numbering)}
            points={config.showPoints && graded ? (item.pointsOverride ?? question.points) : null}
            lines={item.linesOverride}
            style={resolveQuestionStyle(config, question.type)}
            theme={config.theme}
          />
          {revealed ? (
            // Off the paper, in another colour: a note for the teacher, not the pupils.
            <p
              data-slot="reseni"
              className="mt-1 rounded-[var(--radius-inner)] bg-brand-bg px-2 py-1 text-xs text-fg-soft"
            >
              <span className="font-medium">{t('tests:page.sampleAnswer')}</span>
              {formatAnswer(question, 'A')}
              {question.explanation ? <span className="text-fg-muted"> — {question.explanation}</span> : null}
            </p>
          ) : null}
        </>
      ) : item.kind === 'puzzle' && item.puzzle ? (
        // A puzzle in the outline is only shown as it prints; words and grid are
        // changed on the Puzzles screen, not here.
        <PaperPuzzle puzzle={item.puzzle} className="text-paper-fg" />
      ) : item.kind === 'question' || item.kind === 'puzzle' ? (
        // A question or puzzle without content (gone from the bank, no snapshot) —
        // it used to fall through to the instruction branch and show as an empty field.
        <BrokenItem
          message={
            item.kind === 'puzzle'
              ? t('tests:page.puzzleGone')
              : t('tests:page.questionGone')
          }
        />
      ) : item.kind === 'text' ? (
        item.textContent ? (
          <TextItemEditor
            text={item.text ?? ''}
            variant={item.textContent.variant}
            config={config}
            onChange={(text) => onPatch(item.key, { text })}
          />
        ) : (
          <BrokenItem />
        )
      ) : item.kind === 'table' ? (
        item.table ? (
          <TableItemEditor table={item.table} shade={config.theme.accentSoft} onChange={(table) => onPatch(item.key, { table })} />
        ) : (
          <BrokenItem />
        )
      ) : item.kind === 'page_break' ? (
        <p className="my-2 flex items-center gap-2 text-xs text-fg-muted">
          <span aria-hidden="true" className="h-px flex-1 border-b border-dashed border-line" />
          {t('tests:page.newPage')}
          <span aria-hidden="true" className="h-px flex-1 border-b border-dashed border-line" />
        </p>
      ) : item.kind === 'heading' ? (
        <div
          className="text-paper-fg"
          style={
            config.theme.sectionBanner
              ? // A playful worksheet: the heading is a band in the accent colour, as in the PDF.
                {
                  marginTop: pt(config.sectionStyle.spacingBefore),
                  marginBottom: pt(6),
                  padding: `${pt(3)} ${pt(8)}`,
                  borderRadius: pt(config.theme.radius),
                  backgroundColor: config.theme.accent,
                  color: '#ffffff',
                }
              : {
                  marginTop: pt(config.sectionStyle.spacingBefore),
                  marginBottom: pt(4),
                  paddingBottom: pt(2),
                  color: config.theme.accent,
                  borderBottom: config.sectionStyle.rule ? `1px solid ${config.theme.accent}` : undefined,
                }
          }
        >
          <input
            className="w-full bg-transparent font-bold outline-none placeholder:opacity-40"
            style={{
              fontSize: pt(config.sectionStyle.fontSize),
              textTransform: config.sectionStyle.uppercase ? 'uppercase' : undefined,
            }}
            aria-label={t('tests:page.heading')}
            placeholder={t('tests:page.heading')}
            value={item.text ?? ''}
            onChange={(event) => onPatch(item.key, { text: event.target.value })}
          />
        </div>
      ) : (
        <input
          className="w-full bg-transparent italic text-paper-fg opacity-90 outline-none placeholder:opacity-40"
          style={{ marginTop: pt(8) }}
          aria-label={t('tests:page.instructionField')}
          placeholder={t('tests:page.instructionField')}
          value={item.text ?? ''}
          onChange={(event) => onPatch(item.key, { text: event.target.value })}
        />
      )}
    </li>
  )
}

/** A worksheet item whose stored content failed the schema — the rest of the worksheet lives on. */
function BrokenItem({
  message = t('tests:page.broken'),
}: {
  message?: string
}) {
  return (
    <p className="my-2 rounded-[var(--radius-inner)] bg-danger-bg px-2 py-1 text-sm text-danger">
      {message}
    </p>
  )
}
