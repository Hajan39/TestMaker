'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BusyButton, Button, Card, Input, Label, toast } from '@testmaker/ui'
import { errorMessage, fetchOrOffline, jsonBody, readJson, SERVER_TROUBLE } from '@/lib/requestJson'

export function ZmenaHeslaForm({ vynucena }: { vynucena: boolean }) {
  const router = useRouter()
  const [stare, setStare] = useState('')
  const [nove, setNove] = useState('')
  const [znovu, setZnovu] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [odhlasuji, setOdhlasuji] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (nove !== znovu) {
      setError('Nové heslo se v obou polích neshoduje.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetchOrOffline('/api/zmena-hesla', jsonBody('POST', { stare, nove }), 'Heslo se nepodařilo změnit.')
      const data = await readJson(response)
      // 401 tu znamená špatné dosavadní heslo, ne vypršelé přihlášení — hláška serveru má přednost.
      if (!response.ok) throw new Error(data.error ?? `Heslo se nepodařilo změnit. ${SERVER_TROUBLE}`)
      toast.success('Heslo změněno.')
      router.push('/')
      router.refresh()
    } catch (submitError) {
      setError(errorMessage(submitError, 'Heslo se nepodařilo změnit.'))
      setBusy(false)
    }
  }

  /** Cesta ven i bez nového hesla — třeba když u počítače sedí někdo jiný. */
  async function odhlasit() {
    setOdhlasuji(true)
    try {
      const response = await fetch('/api/logout', { method: 'POST' })
      if (!response.ok) throw new Error()
    } catch {
      toast.error('Odhlášení se nepovedlo, zkus to znovu.')
      setOdhlasuji(false)
      return
    }
    router.replace('/login')
    router.refresh()
  }

  return (
    <Card className="mx-auto max-w-sm p-6">
      <h1 className="text-lg font-semibold text-fg">Změna hesla</h1>
      <p className="mt-1 text-sm text-fg-soft">
        Zvol si vlastní heslo.
        {vynucena ? ' Dokud si ho nenastavíš, do aplikace se nedostaneš.' : null}
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
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <BusyButton type="submit" busy={busy} busyLabel="Ukládám…" disabled={nove.length === 0}>
            Uložit heslo
          </BusyButton>
          {vynucena ? null : (
            <Button variant="ghost" asChild>
              <Link href="/">Zpět</Link>
            </Button>
          )}
          <BusyButton
            type="button"
            variant="ghost"
            className="ml-auto"
            busy={odhlasuji}
            busyLabel="Odhlašuji…"
            onClick={() => void odhlasit()}
          >
            Odhlásit se
          </BusyButton>
        </div>
      </form>
    </Card>
  )
}
