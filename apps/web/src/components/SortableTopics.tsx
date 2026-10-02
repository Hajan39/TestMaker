'use client'

import { useId, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { Button, cn, toast } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { MoveTopic } from '@/components/MoveTopic'
import { useCanEdit } from '@/components/Permissions'
import { TopicTile } from '@/components/TopicTile'
import type { ClassTopicNode } from '@/lib/library'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'

/**
 * The grade's topics as tiles that can be reordered: with the mouse by the
 * handle, or from the keyboard (space on the handle, arrows, space). The new
 * order is saved right away and applies to the whole school. Read-only users
 * see the tiles without handles.
 */
export function SortableTopics({
  gradeId,
  gradeName,
  topics,
  manualOrder,
}: {
  gradeId: string
  gradeName: string
  topics: ClassTopicNode[]
  manualOrder: boolean
}) {
  const canEdit = useCanEdit()
  const router = useRouter()
  // The reorder shows right away; the server confirms it by refreshing the page.
  const [order, setOrder] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // Without `id`, dnd-kit numbers `aria-describedby` differently on the server
  // and in the browser, and the page reports a hydration mismatch.
  const dndId = useId()

  const byId = new Map(topics.map((topic) => [topic.id, topic]))
  const shown =
    order && order.length === topics.length && order.every((id) => byId.has(id))
      ? order.map((id) => byId.get(id)!)
      : topics

  async function save(topicIds: string[] | null) {
    setSaving(true)
    try {
      await requestJson('/api/library/poradi', jsonBody('POST', { gradeId, topicIds }), t('library:sortableTopics.saveFailed'))
      router.refresh()
    } catch (error) {
      setOrder(null)
      toast.error(errorMessage(error, t('library:sortableTopics.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = shown.map((topic) => topic.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    const next = arrayMove(ids, from, to)
    setOrder(next)
    void save(next)
  }

  const tile = (topic: ClassTopicNode, handle?: ReactNode) => (
    <TopicTile
      id={topic.id}
      name={topic.name}
      materialCount={topic.materialCount}
      questionCount={topic.questionCount}
      lowContent={topic.lowContent}
      jobState={topic.jobState}
      actions={
        <>
          {handle}
          <MoveTopic topicId={topic.id} currentGradeName={gradeName} />
        </>
      }
    />
  )

  if (!canEdit) {
    return (
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic) => (
          <li key={topic.id}>{tile(topic)}</li>
        ))}
      </ul>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
        <p>
          {manualOrder ? t('library:sortableTopics.manualHint') : t('library:sortableTopics.alphabeticalHint')}
        </p>
        {manualOrder ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setOrder(null)
              void save(null)
            }}
          >
            {t('library:sortableTopics.sortAlphabetically')}
          </Button>
        ) : null}
      </div>
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={shown.map((topic) => topic.id)} strategy={rectSortingStrategy}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="grade-topics">
            {shown.map((topic) => (
              <SortableTopic key={topic.id} topic={topic} disabled={saving}>
                {(handle) => tile(topic, handle)}
              </SortableTopic>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableTopic({
  topic,
  disabled,
  children,
}: {
  topic: ClassTopicNode
  disabled: boolean
  children: (handle: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: topic.id, disabled })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 opacity-80')}
    >
      {children(
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="cursor-grab rounded p-0.5 text-fg-muted hover:text-fg active:cursor-grabbing"
          aria-label={t('library:sortableTopics.handleLabel', { name: topic.name })}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>,
      )}
    </li>
  )
}
