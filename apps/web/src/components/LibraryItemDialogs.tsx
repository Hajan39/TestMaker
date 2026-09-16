'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import {
  BusyButton,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@testmaker/ui'
import type { LibraryKind } from '@/lib/library'

/**
 * Zakládání a přejmenování v knihovně.
 *
 * Do teď vznikl předmět, ročník i téma jedině importem souborů. Učitelka ale
 * potřebuje i prázdné téma, do kterého si otázky napíše sama, a opravu názvu
 * předmětu, který vznikl z názvu složky velkými písmeny.
 *
 * Obě akce sdílejí jeden dialog s jediným polem na název: liší se jen tím,
 * co se posílá na `/api/library` a kam se jde potom.
 */

const NAZVY: Record<LibraryKind, { novy: string; prejmenovat: string; popisek: string }> = {
  subject: { novy: 'Nový předmět', prejmenovat: 'Přejmenovat předmět', popisek: 'Název předmětu' },
  grade: { novy: 'Nový ročník', prejmenovat: 'Přejmenovat ročník', popisek: 'Název ročníku' },
  topic: { novy: 'Nové téma', prejmenovat: 'Přejmenovat téma', popisek: 'Název tématu' },
}

const NAPOVEDA: Record<LibraryKind, string> = {
  subject: 'Např. Přírodopis. Ročníky a témata se do něj doplní potom.',
  grade: 'Např. 8. ročník. Ročníky se řadí podle čísla na začátku názvu.',
  topic: 'Téma vznikne prázdné — otázky do něj můžeš napsat sama nebo k němu přidat materiály.',
}

interface NameDialogProps {
  title: string
  fieldLabel: string
  hint?: string
  initialName: string
  confirmLabel: string
  busyLabel: string
  trigger: ReactNode
  /** Vrací chybovou hlášku, nebo `null`, když se akce povedla. */
  onSubmit: (name: string) => Promise<string | null>
}

function NameDialog({
  title,
  fieldLabel,
  hint,
  initialName,
  confirmLabel,
  busyLabel,
  trigger,
  onSubmit,
}: NameDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function change(next: boolean) {
    setOpen(next)
    // Při každém otevření i zavření se pole vrací k platnému názvu a chyba mizí.
    // Otevřít dialog podruhé a najít v něm nedopsaný název, starou chybu nebo
    // jméno, které už se mezitím změnilo, by mátlo.
    setName(initialName)
    setError(null)
  }

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const failure = await onSubmit(name.trim())
      if (failure) {
        setError(failure)
        return
      }
      change(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hint ? <DialogDescription>{hint}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="library-item-name">{fieldLabel}</Label>
          <Input
            id="library-item-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
          />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)}>
            Zrušit
          </Button>
          <BusyButton busy={busy} busyLabel={busyLabel} disabled={!name.trim()} onClick={() => void submit()}>
            {confirmLabel}
          </BusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Odpověď API přeložená na hlášku, kterou má smysl ukázat učitelce. */
async function problem(response: Response): Promise<string | null> {
  if (response.ok) return null
  const detail = (await response.json().catch(() => ({}))) as { error?: string }
  return detail.error ?? `Nepovedlo se to (${response.status}).`
}

/**
 * Tlačítko „Nový předmět / ročník / téma“ s dialogem na název.
 * `parentId` je předmět u ročníku a ročník u tématu; u předmětu se nevyplňuje.
 */
export function NewLibraryItem({
  kind,
  parentId,
  label,
  iconOnly = false,
  size = 'sm',
  variant = 'outline',
}: {
  kind: LibraryKind
  parentId?: string
  label?: string
  /** Jen ikona s popiskem při najetí — pro místa, kde by se texty u každé položky sčítaly. */
  iconOnly?: boolean
  size?: ComponentProps<typeof Button>['size']
  variant?: ComponentProps<typeof Button>['variant']
}) {
  const router = useRouter()
  const popisek = label ?? NAZVY[kind].novy

  return (
    <NameDialog
      title={NAZVY[kind].novy}
      fieldLabel={NAZVY[kind].popisek}
      hint={NAPOVEDA[kind]}
      initialName=""
      confirmLabel="Založit"
      busyLabel="Zakládám…"
      trigger={
        iconOnly ? (
          <Button size="icon-sm" variant={variant} aria-label={popisek} title={popisek}>
            <Plus aria-hidden />
          </Button>
        ) : (
          <Button size={size} variant={variant}>
            {popisek}
          </Button>
        )
      }
      onSubmit={async (name) => {
        const response = await fetch('/api/library', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, name, parentId: parentId ?? null }),
        })
        const failure = await problem(response)
        if (failure) return failure

        const { id } = (await response.json()) as { id: string }
        // Po založení je užitečné rovnou být tam, kde se dá pokračovat:
        // v novém tématu se píšou otázky, v novém ročníku se zakládají témata.
        if (kind === 'topic') router.push(`/topics/${id}`)
        else if (kind === 'grade') router.push(`/?grade=${id}`)
        router.refresh()
        return null
      }}
    />
  )
}

/**
 * Tlačítko „Přejmenovat“ u položky knihovny. `iconOnly` je pro místa, kde by
 * popisek u každé položky zvlášť přebil to podstatné — třeba u dlaždic témat.
 */
export function RenameLibraryItem({
  kind,
  id,
  name,
  label,
  iconOnly = false,
  size = 'sm',
  variant = 'ghost',
}: {
  kind: LibraryKind
  id: string
  name: string
  label?: string
  iconOnly?: boolean
  size?: ComponentProps<typeof Button>['size']
  variant?: ComponentProps<typeof Button>['variant']
}) {
  const router = useRouter()
  const popisek = label ?? NAZVY[kind].prejmenovat

  return (
    <NameDialog
      title={NAZVY[kind].prejmenovat}
      fieldLabel={NAZVY[kind].popisek}
      initialName={name}
      confirmLabel="Uložit"
      busyLabel="Ukládám…"
      trigger={
        iconOnly ? (
          <Button size="icon-sm" variant={variant} aria-label={popisek} title={popisek}>
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button size={size} variant={variant}>
            {popisek}
          </Button>
        )
      }
      onSubmit={async (next) => {
        const response = await fetch('/api/library', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, id, name: next }),
        })
        const failure = await problem(response)
        if (failure) return failure
        router.refresh()
        return null
      }}
    />
  )
}
