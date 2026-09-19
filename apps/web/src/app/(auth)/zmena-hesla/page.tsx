'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Input, Label } from '@testmaker/ui'

/**
 * Změna vlastního hesla. Po resetu správcem sem brána pustí a nikam jinam —
 * heslo, které zná ještě někdo další, nemá zůstat v provozu.
 */
export default function ZmenaHeslaPage() {
  const router = useRouter()
  const [stare, setStare] = useState('')
  const [nove, setNove] = useState('')
  const [znovu, setZnovu] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (nove !== znovu) {
      setError('Nové heslo se v obou polích neshoduje.')
      return
    }
    setBusy(true)
    setError(null)
    const response = await fetch('/api/zmena-hesla', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stare, nove }),
    })
    setBusy(false)
    if (!response.ok) {
      const detail = (await response.json()) as { error?: string }
      setError(detail.error ?? 'Heslo se nepodařilo změnit.')
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <Card className="mx-auto max-w-sm p-6">
      <h1 className="text-lg font-semibold text-fg">Změna hesla</h1>
      <p className="mt-1 text-sm text-fg-soft">
        Zvol si vlastní heslo. Dokud si ho nenastavíš, do aplikace se nedostaneš.
      </p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div>
          <Label htmlFor="stare">Dosavadní heslo</Label>
          <Input
            id="stare"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={stare}
            onChange={(event) => setStare(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="nove">Nové heslo</Label>
          <Input
            id="nove"
            type="password"
            autoComplete="new-password"
            value={nove}
            onChange={(event) => setNove(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="znovu">Nové heslo znovu</Label>
          <Input
            id="znovu"
            type="password"
            autoComplete="new-password"
            value={znovu}
            onChange={(event) => setZnovu(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy || nove.length === 0}>
          Uložit heslo
        </Button>
      </form>
    </Card>
  )
}
