'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, OTAZKY, pocet, toast } from '@testmaker/ui'

/**
 * Otázky napsané v Claude Code (`/otazky`): stáhnout materiály tématu
 * jako text a nahrát zpátky hotový soubor. Funguje i bez modelu v aplikaci.
 */
export function ClaudeCodeImport({ topicId }: { topicId: string }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const base = `/api/topics/${encodeURIComponent(topicId)}`

  async function upload(file: File) {
    setBusy(true)
    try {
      let response: Response
      try {
        response = await fetch(`${base}/otazky-soubor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await file.text(),
        })
      } catch {
        // Výpadek sítě — fetch samo o sobě žádnou odpověď nevrátí.
        toast.error('Otázky se nepodařilo nahrát — zkontroluj připojení a zkus to znovu.')
        return
      }
      // Odpověď nemusí být JSON (např. spadne-li server dřív, než stihne
      // odpovědět tělem) — bez vlastního try/catch by se to ztratilo jako
      // nezachycené odmítnutí a učitelka by neviděla vůbec nic.
      let data: { created?: number; rejected?: unknown[]; error?: string }
      try {
        data = (await response.json()) as { created?: number; rejected?: unknown[]; error?: string }
      } catch {
        toast.error('Otázky se nepodařilo nahrát — zkontroluj připojení a zkus to znovu.')
        return
      }
      if (!response.ok) {
        toast.error(data.error ?? 'Otázky se nepodařilo nahrát.')
        return
      }
      const odmitnuto = data.rejected?.length ?? 0
      toast.success(
        `Nahráno ${pocet(data.created ?? 0, OTAZKY)}` +
          (odmitnuto > 0 ? `, ${odmitnuto} neprošlo kontrolou (spusť v Claude Code otazky:over)` : ''),
      )
      router.refresh()
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
      <span>Otázky z Claude Code:</span>
      <Button asChild variant="outline" size="sm">
        <a href={`${base}/zdroj`} download>
          Stáhnout materiály
        </a>
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Nahrávám…' : 'Nahrát otázky'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />
    </div>
  )
}
