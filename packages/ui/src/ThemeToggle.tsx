'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from './cn'

export type ThemeChoice = 'system' | 'light' | 'dark'

/** Klíč v `localStorage`; stejný čte i skript v hlavičce dokumentu. */
export const THEME_STORAGE_KEY = 'testmaker-theme'

/**
 * Skript, který běží dřív než se stránka vykreslí, aby při tmavém motivu
 * nezablikala světlá. Vkládá se do `<head>` jako `dangerouslySetInnerHTML`;
 * záměrně bez závislostí a bez `import`, protože běží mimo bundle.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}`

function apply(choice: ThemeChoice) {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Světlý motiv', Icon: Sun },
  { value: 'dark', label: 'Tmavý motiv', Icon: Moon },
  { value: 'system', label: 'Podle systému', Icon: Monitor },
]

/**
 * Přepínač světlého a tmavého motivu. Výchozí je nastavení systému, dokud si
 * učitelka nevybere jinak; volba se pamatuje v prohlížeči, na serveru se nic
 * neukládá.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>('system')
  // Než se komponenta na klientovi probudí, neví, co je v `localStorage` —
  // do té doby se nesmí zvýraznit žádná volba, jinak se server a klient
  // rozejdou a React to ohlásí jako chybu hydratace.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    setChoice(stored === 'dark' || stored === 'light' ? stored : 'system')
    setReady(true)
  }, [])

  // Při volbě „podle systému" reaguje aplikace i na pozdější přepnutí v systému.
  useEffect(() => {
    if (choice !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [choice])

  function pick(next: ThemeChoice) {
    setChoice(next)
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Soukromé okno bez úložiště — motiv pak platí jen do zavření stránky.
    }
    apply(next)
  }

  return (
    <div
      className={cn('flex items-center gap-0.5 rounded-[var(--radius-outer)] border border-line p-0.5', className)}
      role="group"
      aria-label="Motiv"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={ready ? choice === value : undefined}
          onClick={() => pick(value)}
          className={cn(
            'rounded-[var(--radius-inner)] p-1 text-fg-muted transition-colors hover:text-fg',
            ready && choice === value ? 'bg-brand-bg text-brand' : '',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  )
}
