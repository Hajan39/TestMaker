import type { Metadata } from 'next'
import { THEME_INIT_SCRIPT, Toaster, TooltipProvider } from '@testmaker/ui'
import { authMode } from '@/lib/session'
import { AppChrome } from './AppChrome'
import './globals.css'

export const metadata: Metadata = {
  title: 'TestMaker – generátor písemek',
  description: 'Z výukových materiálů vytvoří banku otázek a poskládá test do PDF.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Bez přihlašování (lokální běh) nemá odhlašovací tlačítko co dělat.
  const prihlasovaniZapnuto = authMode() === 'zapnuto'

  return (
    <html lang="cs" suppressHydrationWarning>
      <head>
        {/* Motiv se nastaví ještě před vykreslením, jinak tmavý režim zabliká bílou. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full antialiased">
        <TooltipProvider delayDuration={300}>
          <AppChrome prihlasovaniZapnuto={prihlasovaniZapnuto}>{children}</AppChrome>
        </TooltipProvider>
        {/*
          Hlášky sedí vpravo dole: nahoře je lišta, vlevo navigace a uprostřed
          se otevírají dialogy — v pravém dolním rohu tak nic nepřekrývají.
          Barvy si berou z tokenů, takže se v tmavém režimu přebarví samy.
        */}
        <Toaster position="bottom-right" />
      </body>
    </html>
  )
}
