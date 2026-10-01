'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { t } from '@testmaker/core/i18n'
import { cn } from './cn'

export type ThemeChoice = 'system' | 'light' | 'dark'

/** `localStorage` key; the script in the document head reads the same one. */
export const THEME_STORAGE_KEY = 'testmaker-theme'

/**
 * Script that runs before the page renders so a dark theme does not flash
 * light. Injected into `<head>` via `dangerouslySetInnerHTML`; deliberately
 * dependency-free and without `import`, as it runs outside the bundle.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}`

function apply(choice: ThemeChoice) {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

const OPTIONS: { value: ThemeChoice; Icon: typeof Sun }[] = [
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
  { value: 'system', Icon: Monitor },
]

/**
 * Light/dark theme toggle. Defaults to the system setting until the teacher
 * picks otherwise; the choice is remembered in the browser, nothing is stored
 * on the server.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>('system')
  // Until the component hydrates it does not know what is in `localStorage` —
  // no option may be highlighted before then, otherwise server and client
  // diverge and React reports a hydration error.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    setChoice(stored === 'dark' || stored === 'light' ? stored : 'system')
    setReady(true)
  }, [])

  // With "system" selected the app also follows later system switches.
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
      // Private window without storage — the theme then lasts until the page closes.
    }
    apply(next)
  }

  return (
    <div
      className={cn('flex items-center gap-0.5 rounded-[var(--radius-outer)] border border-line p-0.5', className)}
      role="group"
      aria-label={t('ui:themeToggle.group')}
    >
      {OPTIONS.map(({ value, Icon }) => {
        const label = t(`ui:themeToggle.${value}`)
        return (
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
        )
      })}
    </div>
  )
}
