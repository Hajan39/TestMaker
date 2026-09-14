'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Card, Input, Label, Select } from '@testmaker/ui'

export interface GroupMaterial {
  id: string
  fileName: string
  charCount: number
  pageCount: number | null
  needsOcr: boolean
  duplicateOfId: string | null
  duplicateScore: number | null
}

/**
 * Skupina materiálů jednoho tématu. Učitel ji může přejmenovat, sloučit s jinou
 * skupinou téhož ročníku nebo z ní jednotlivý materiál vyjmout.
 */
export function TopicGroup({
  topicId,
  topicName,
  materials,
}: {
  topicId: string
  topicName: string
  materials: GroupMaterial[]
}) {
  const router = useRouter()
  const [name, setName] = useState(topicName)
  const [siblings, setSiblings] = useState<{ id: string; name: string }[]>([])
  const [mergeTarget, setMergeTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [manage, setManage] = useState(false)

  useEffect(() => {
    if (!manage) return
    void fetch(`/api/topics?siblingsOf=${encodeURIComponent(topicId)}`)
      .then((response) => response.json())
      .then((data: { topics: { id: string; name: string }[] }) => setSiblings(data.topics))
  }, [manage, topicId])

  async function call(method: string, body: unknown) {
    setBusy(true)
    try {
      await fetch('/api/topics', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const active = materials.filter((material) => !material.duplicateOfId)

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">
          Skupina materiálů ({active.length}
          {materials.length !== active.length ? ` + ${materials.length - active.length} duplicit` : ''})
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setManage(!manage)}>
          {manage ? 'Hotovo' : 'Upravit skupinu'}
        </Button>
      </div>

      <ul className="mt-2 space-y-1 text-sm">
        {materials.map((material) => {
          const original = materials.find((row) => row.id === material.duplicateOfId)
          return (
            <li key={material.id} className="flex flex-wrap items-center gap-2">
              <span className={material.duplicateOfId ? 'text-ink-400' : 'text-ink-800'}>
                {material.fileName}
              </span>
              <span className="text-ink-400">
                {material.charCount.toLocaleString('cs')} znaků
                {material.pageCount ? `, ${material.pageCount} str.` : ''}
              </span>
              {material.needsOcr ? <Badge tone="warn">skoro bez textu</Badge> : null}
              {material.duplicateOfId ? (
                <span className="text-xs text-ink-500">
                  stejný obsah jako {original?.fileName ?? 'jiný materiál'}
                  {material.duplicateScore ? ` (shoda ${Math.round(material.duplicateScore * 100)} %)` : ''}
                </span>
              ) : null}
              {manage && siblings.length > 0 ? (
                <Select
                  className="ml-auto w-56"
                  value=""
                  disabled={busy}
                  onChange={(event) =>
                    event.target.value &&
                    void call('PUT', { materialId: material.id, topicId: event.target.value })
                  }
                >
                  <option value="">Přesunout do…</option>
                  {siblings.map((sibling) => (
                    <option key={sibling.id} value={sibling.id}>
                      {sibling.name}
                    </option>
                  ))}
                </Select>
              ) : null}
            </li>
          )
        })}
      </ul>

      {manage ? (
        <div className="mt-4 grid gap-3 border-t border-ink-100 pt-4 sm:grid-cols-2">
          <div>
            <Label>Název skupiny</Label>
            <div className="flex gap-2">
              <Input value={name} onChange={(event) => setName(event.target.value)} />
              <Button
                size="sm"
                disabled={busy || !name.trim() || name === topicName}
                onClick={() => void call('PATCH', { id: topicId, name })}
              >
                Uložit
              </Button>
            </div>
          </div>
          <div>
            <Label>Sloučit do jiné skupiny</Label>
            <div className="flex gap-2">
              <Select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
                <option value="">Vyber skupinu…</option>
                {siblings.map((sibling) => (
                  <option key={sibling.id} value={sibling.id}>
                    {sibling.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={busy || !mergeTarget}
                onClick={() => void call('POST', { sourceId: topicId, targetId: mergeTarget })}
              >
                Sloučit
              </Button>
            </div>
            <p className="mt-1 text-xs text-ink-500">
              Materiály i otázky se přesunou do vybrané skupiny, tato zanikne.
            </p>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
