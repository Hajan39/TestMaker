'use client'

import { useRouter } from 'next/navigation'
import { DeleteButton } from '@testmaker/ui'

type Kind = 'subject' | 'grade' | 'topic'

interface Impact {
  name: string
  grades: number
  topics: number
  materials: number
  questions: number
  affectedTests: string[]
}

const TITLES: Record<Kind, string> = {
  subject: 'Smazat předmět',
  grade: 'Smazat ročník',
  topic: 'Smazat skupinu',
}

/** Vypíše dopad lidsky: jen to, čeho se to skutečně týká. */
function describeImpact(impact: Impact) {
  const parts: string[] = []
  if (impact.grades > 0) parts.push(`${impact.grades} ${plural(impact.grades, 'ročník', 'ročníky', 'ročníků')}`)
  if (impact.topics > 0) parts.push(`${impact.topics} ${plural(impact.topics, 'téma', 'témata', 'témat')}`)
  if (impact.materials > 0)
    parts.push(`${impact.materials} ${plural(impact.materials, 'materiál', 'materiály', 'materiálů')}`)
  if (impact.questions > 0)
    parts.push(`${impact.questions} ${plural(impact.questions, 'otázku', 'otázky', 'otázek')}`)

  return (
    <>
      <p>
        Smaže se <strong>{impact.name}</strong>
        {parts.length > 0 ? <> a s ním {parts.join(', ')}.</> : <> (nic pod tím zatím není).</>}
      </p>
      {impact.affectedTests.length > 0 ? (
        <p className="text-danger">
          Pozor: otázky z tohoto místa jsou použité v uložených testech ({impact.affectedTests.join(', ')}).
          Z těch testů zmizí.
        </p>
      ) : null}
      {impact.materials > 0 ? (
        <p className="text-fg-muted">
          Soubory na disku zůstanou. Materiály se dají znovu naimportovat ze složky.
        </p>
      ) : null}
    </>
  )
}

function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one
  if (count < 5) return few
  return many
}

/** Smazání předmětu, ročníku nebo skupiny včetně všeho, co pod nimi leží. */
export function DeleteFromLibrary({
  kind,
  id,
  label,
  redirectTo,
}: {
  kind: Kind
  id: string
  label?: string
  /** Kam odejít po smazání; bez toho se jen obnoví stránka. */
  redirectTo?: string
}) {
  const router = useRouter()

  return (
    <DeleteButton
      label={label ?? TITLES[kind]}
      title={`${TITLES[kind]}?`}
      confirmLabel="Smazat"
      describe={async () => {
        const response = await fetch(
          `/api/library?kind=${kind}&id=${encodeURIComponent(id)}`,
        )
        if (!response.ok) return <p className="text-danger">Nepodařilo se zjistit, co se smaže.</p>
        return describeImpact((await response.json()) as Impact)
      }}
      onConfirm={async () => {
        await fetch(`/api/library?kind=${kind}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (redirectTo) router.push(redirectTo)
        router.refresh()
      }}
    />
  )
}
