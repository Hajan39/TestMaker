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
import { MoveTopic } from '@/components/MoveTopic'
import { useMuzeMenit } from '@/components/Prava'
import { TopicTile } from '@/components/TopicTile'
import type { ClassTopicNode } from '@/lib/library'

/**
 * Témata ročníku jako dlaždice, které jde přeskládat: myší za úchyt, nebo
 * z klávesnice (na úchytu mezerník, šipky, mezerník). Nové pořadí se uloží
 * hned a platí pro celou školu. Kdo smí jen číst, vidí dlaždice bez úchytů.
 */
export function SortableTopics({
  gradeId,
  gradeName,
  topics,
  rucniPoradi,
}: {
  gradeId: string
  gradeName: string
  topics: ClassTopicNode[]
  rucniPoradi: boolean
}) {
  const muzeMenit = useMuzeMenit()
  const router = useRouter()
  // Přeskládání se ukáže hned; server ho potvrdí obnovením stránky.
  const [poradi, setPoradi] = useState<string[] | null>(null)
  const [ukladam, setUkladam] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // Bez `id` čísluje dnd-kit `aria-describedby` jinak na serveru a jinak
  // v prohlížeči a stránka hlásí nesoulad při hydrataci.
  const dndId = useId()

  const podleId = new Map(topics.map((topic) => [topic.id, topic]))
  const zobrazena =
    poradi && poradi.length === topics.length && poradi.every((id) => podleId.has(id))
      ? poradi.map((id) => podleId.get(id)!)
      : topics

  async function ulozit(topicIds: string[] | null) {
    setUkladam(true)
    try {
      const response = await fetch('/api/library/poradi', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gradeId, topicIds }),
      })
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(detail.error ?? `Pořadí se nepodařilo uložit (${response.status}).`)
      }
      router.refresh()
    } catch (error) {
      setPoradi(null)
      toast.error(error instanceof Error ? error.message : 'Pořadí se nepodařilo uložit.')
    } finally {
      setUkladam(false)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = zobrazena.map((topic) => topic.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    const next = arrayMove(ids, from, to)
    setPoradi(next)
    void ulozit(next)
  }

  const dlazdice = (topic: ClassTopicNode, uchyt?: ReactNode) => (
    <TopicTile
      id={topic.id}
      name={topic.name}
      materialCount={topic.materialCount}
      questionCount={topic.questionCount}
      lowContent={topic.lowContent}
      jobState={topic.jobState}
      actions={
        <>
          {uchyt}
          <MoveTopic topicId={topic.id} currentGradeName={gradeName} />
        </>
      }
    />
  )

  if (!muzeMenit) {
    return (
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic) => (
          <li key={topic.id}>{dlazdice(topic)}</li>
        ))}
      </ul>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
        <p>
          {rucniPoradi
            ? 'Témata jsou seřazená ručně. Přeskládáš je přetažením za úchyt.'
            : 'Témata jsou podle abecedy. Přeskládáš je přetažením za úchyt.'}
        </p>
        {rucniPoradi ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={ukladam}
            onClick={() => {
              setPoradi(null)
              void ulozit(null)
            }}
          >
            Seřadit podle abecedy
          </Button>
        ) : null}
      </div>
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={zobrazena.map((topic) => topic.id)} strategy={rectSortingStrategy}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="temata-rocniku">
            {zobrazena.map((topic) => (
              <SortableTopic key={topic.id} topic={topic} disabled={ukladam}>
                {(uchyt) => dlazdice(topic, uchyt)}
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
  children: (uchyt: ReactNode) => ReactNode
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
          aria-label={`Přesunout téma ${topic.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>,
      )}
    </li>
  )
}
