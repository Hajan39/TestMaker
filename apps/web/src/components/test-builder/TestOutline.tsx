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
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { paginate } from '@testmaker/core/pdf/estimate'
import type { ResolvedTestItem, Template } from '@testmaker/core/schema'
import { Fragment, useMemo } from 'react'
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  QuestionPreview,
} from '@testmaker/ui'
import { formatPoints, type DraftItem } from './types'

/** Osnova testu — pořadí položek se mění přetažením nebo klávesnicí. */
export function TestOutline({
  items,
  graded,
  template,
  onReorder,
  onRemove,
  onPatch,
  onAdd,
}: {
  items: DraftItem[]
  graded: boolean
  /** Slouží jen k odhadu počtu stran pod osnovou — bez šablony se odhad vynechá. */
  template: Template | null
  onReorder: (from: number, to: number) => void
  onRemove: (key: string) => void
  onPatch: (key: string, patch: Partial<DraftItem>) => void
  /** `index` je místo, kam položka přijde (0 = úplně nahoru); bez něj na konec. */
  onAdd: (kind: 'heading' | 'instruction' | 'page_break', index?: number) => void
}) {
  const questionCount = items.filter((item) => item.kind === 'question').length
  const totalPoints = items.reduce(
    (sum, item) => (item.kind === 'question' ? sum + (item.pointsOverride ?? item.question?.points ?? 0) : sum),
    0,
  )
  const pageCount = useMemo(() => {
    if (!template) return null
    const resolved: ResolvedTestItem[] = items.map((item, index) => ({
      id: item.key,
      testId: 'draft',
      order: index,
      kind: item.kind,
      questionId: item.questionId,
      text: item.text,
      pointsOverride: item.pointsOverride,
      linesOverride: item.linesOverride,
      question: item.question,
    }))
    return paginate(resolved, template.config).length
  }, [items, template])
  /**
   * Táž otázka smí být v testu víckrát. Aby se v osnově poznalo, který výskyt
   * je který, dostanou opakované otázky pořadí použití.
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
      labels.set(item.key, `${order}. použití`)
    }
    return labels
  }, [items])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((item) => item.key === active.id)
    const to = items.findIndex((item) => item.key === over.id)
    if (from === -1 || to === -1) return
    onReorder(from, to)
  }

  return (
    <Card className="flex h-full flex-col p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Obsah testu</h2>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => onAdd('heading')}>
            + Nadpis části
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdd('instruction')}>
            + Pokyn
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdd('page_break')}>
            + Nová strana
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="Test je prázdný" hint="Přidej otázky z banky vlevo." />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items.map((item) => item.key)} strategy={verticalListSortingStrategy}>
            <ol className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {items.map((item, index) => (
                <Fragment key={item.key}>
                  <InsertSlot index={index} total={items.length} onAdd={onAdd} />
                  <OutlineRow
                    item={item}
                    graded={graded}
                    repeatLabel={repeats.get(item.key) ?? null}
                    onRemove={onRemove}
                    onPatch={onPatch}
                  />
                </Fragment>
              ))}
              <InsertSlot index={items.length} total={items.length} onAdd={onAdd} />
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {items.length > 0 ? (
        <dl className="mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-line-soft pt-2 text-sm text-fg-muted">
          <div>
            <dt className="inline text-fg-soft">Otázek: </dt>
            <dd className="ui-numeric inline">{questionCount}</dd>
          </div>
          {graded ? (
            <div>
              <dt className="inline text-fg-soft">Body: </dt>
              <dd className="ui-numeric inline">{formatPoints(totalPoints)}</dd>
            </div>
          ) : null}
          {pageCount !== null ? (
            <div>
              <dt className="inline text-fg-soft">Odhad stran: </dt>
              <dd className="ui-numeric inline">{pageCount}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </Card>
  )
}

/**
 * Místo mezi položkami, kam jde vložit nadpis, pokyn nebo zalomení strany.
 * Je to obyčejné tlačítko s nabídkou, takže na něj dosáhne i klávesnice —
 * přetahování myší (dnd-kit) tím zůstává nedotčené.
 */
function InsertSlot({
  index,
  total,
  onAdd,
}: {
  index: number
  total: number
  onAdd: (kind: 'heading' | 'instruction' | 'page_break', index?: number) => void
}) {
  const label = index === total ? 'Vložit na konec' : `Vložit před ${index + 1}. položku`
  return (
    <li className="group flex list-none items-center gap-2 py-0.5">
      <span aria-hidden="true" className="h-px flex-1 bg-line-soft" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-2 text-xs text-fg-muted opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={label}
            title={`${label}: nadpis části, pokyn, nebo zalomení strany`}
          >
            +
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onSelect={() => onAdd('heading', index)}>Nadpis části</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAdd('instruction', index)}>Pokyn</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAdd('page_break', index)}>Zalomení strany</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-hidden="true" className="h-px flex-1 bg-line-soft" />
    </li>
  )
}

function OutlineRow({
  item,
  graded,
  repeatLabel,
  onRemove,
  onPatch,
}: {
  item: DraftItem
  graded: boolean
  /** „2. použití" u otázky, která je v testu víckrát; jinak `null`. */
  repeatLabel: string | null
  onRemove: (key: string) => void
  onPatch: (key: string, patch: Partial<DraftItem>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li ref={setNodeRef} style={style} className="rounded border border-line-soft bg-surface p-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-1 shrink-0 cursor-grab touch-none px-1 text-fg-muted active:cursor-grabbing"
          aria-label="Přetáhnout pro změnu pořadí"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <div className="min-w-0 flex-1">
          {item.kind === 'question' && item.question ? (
            <>
              <div className="mb-1 flex flex-wrap items-center gap-1">
                {repeatLabel ? <Badge variant="secondary">{repeatLabel}</Badge> : null}
                {/* Test drží obsah otázky zmrazený k okamžiku zařazení, aby se
                    vytištěná písemka nemohla pozdější úpravou otázky změnit.
                    Když se banka mezitím rozešla, je to vidět tady. */}
                {item.questionMissing ? (
                  <Badge className="bg-draft-bg text-draft-fg">otázka už v bance není</Badge>
                ) : item.questionEdited ? (
                  <Badge className="bg-draft-bg text-draft-fg">otázka byla od zařazení upravena</Badge>
                ) : null}
              </div>
              <QuestionPreview question={item.question} />
            </>
          ) : item.kind === 'page_break' ? (
            <p className="py-2 text-sm text-fg-muted">— zalomení strany —</p>
          ) : (
            <div>
              <Badge variant="secondary">{item.kind === 'heading' ? 'nadpis části' : 'pokyn'}</Badge>
              <Input
                className="mt-1"
                value={item.text ?? ''}
                onChange={(event) => onPatch(item.key, { text: event.target.value })}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.kind === 'question' && graded ? (
            <label className="flex items-center gap-1 text-xs text-fg-muted">
              b.
              <Input
                className="w-16"
                type="number"
                min={0}
                step={0.5}
                aria-label="Body za otázku"
                value={item.pointsOverride ?? item.question?.points ?? 0}
                onChange={(event) => onPatch(item.key, { pointsOverride: Number(event.target.value) || 0 })}
              />
            </label>
          ) : null}
          {/* Kolik místa žák potřebuje, záleží na písemce, ne na otázce —
              proto se počet linek nastavuje tady, ne u otázky v bance. */}
          {item.kind === 'question' && item.question?.type === 'open' ? (
            <label className="flex items-center gap-1 text-xs text-fg-muted">
              řádků
              <Input
                className="w-16"
                type="number"
                min={1}
                max={30}
                step={1}
                aria-label="Řádků na odpověď"
                value={item.linesOverride ?? (item.question.payload as { lines?: number }).lines ?? 4}
                onChange={(event) =>
                  onPatch(item.key, { linesOverride: Math.max(1, Number(event.target.value) || 1) })
                }
              />
            </label>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onRemove(item.key)}>
            Odebrat
          </Button>
        </div>
      </div>
    </li>
  )
}
