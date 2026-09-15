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
import { Badge, Button, Card, EmptyState, Input, QuestionPreview } from '@testmaker/ui'
import type { DraftItem } from './types'

/** Osnova testu — pořadí položek se mění přetažením nebo klávesnicí. */
export function TestOutline({
  items,
  graded,
  onReorder,
  onRemove,
  onPatch,
  onAdd,
}: {
  items: DraftItem[]
  graded: boolean
  onReorder: (from: number, to: number) => void
  onRemove: (key: string) => void
  onPatch: (key: string, patch: Partial<DraftItem>) => void
  onAdd: (kind: 'heading' | 'instruction' | 'page_break') => void
}) {
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
              {items.map((item) => (
                <OutlineRow
                  key={item.key}
                  item={item}
                  graded={graded}
                  onRemove={onRemove}
                  onPatch={onPatch}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  )
}

function OutlineRow({
  item,
  graded,
  onRemove,
  onPatch,
}: {
  item: DraftItem
  graded: boolean
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
            <QuestionPreview question={item.question} />
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
            <Input
              className="w-20"
              type="number"
              min={0}
              step={0.5}
              value={item.pointsOverride ?? item.question?.points ?? 0}
              onChange={(event) => onPatch(item.key, { pointsOverride: Number(event.target.value) || 0 })}
            />
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onRemove(item.key)}>
            Odebrat
          </Button>
        </div>
      </div>
    </li>
  )
}
