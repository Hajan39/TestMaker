'use client'

import { useRouter } from 'next/navigation'
import { DeleteButton, MATERIALY, ROCNIKY, TEMATA, plural, pocet } from '@testmaker/ui'
import { useMuzeMenit } from '@/components/Prava'

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
  topic: 'Smazat téma',
}

/** Vypíše dopad lidsky: jen to, čeho se to skutečně týká. */
function describeImpact(impact: Impact) {
  const parts: string[] = []
  if (impact.grades > 0) parts.push(pocet(impact.grades, ROCNIKY))
  if (impact.topics > 0) parts.push(pocet(impact.topics, TEMATA))
  if (impact.materials > 0) parts.push(pocet(impact.materials, MATERIALY))
  // Ve větě „smaže se … a s ním 5 otázek“ stojí otázka ve čtvrtém pádě.
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

/** Smazání předmětu, ročníku nebo tématu včetně všeho, co pod nimi leží. */
export function DeleteFromLibrary({
  kind,
  id,
  label,
  iconOnly = false,
  redirectTo,
}: {
  kind: Kind
  id: string
  label?: string
  /** Jen ikona koše; popisek se ukáže při najetí. */
  iconOnly?: boolean
  /** Kam odejít po smazání; bez toho se jen obnoví stránka. */
  redirectTo?: string
}) {
  // Náhled nemaže: tlačítko se mu vůbec nenabízí. Hlídka je až za hooky,
  // aby se jich v každém vykreslení volal stejný počet.
  const muzeMenit = useMuzeMenit()
  const router = useRouter()
  if (!muzeMenit) return null

  return (
    <DeleteButton
      label={label ?? TITLES[kind]}
      iconOnly={iconOnly}
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
