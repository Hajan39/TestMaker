import type { Metadata } from 'next'
import { THEME_INIT_SCRIPT, Toaster, TooltipProvider } from '@testmaker/ui'
import { authMode } from '@/lib/session'
import { aktualniUzivatel } from '@/lib/uzivatel'
import { AppChrome } from './AppChrome'
import './globals.css'

export const metadata: Metadata = {
  title: 'TestMaker – generátor písemek',
  description: 'Z výukových materiálů vytvoří banku otázek a poskládá test do PDF.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Jméno v liště dává smysl jen tam, kde se opravdu přihlašuje; lokální běh
  // pracuje pod výchozím účtem a nemá koho ukazovat.
  const uzivatel = authMode() === 'zapnuto' ? await aktualniUzivatel() : null
  const ucet = uzivatel
    ? { jmeno: uzivatel.jmeno, email: uzivatel.email, role: uzivatel.role }
    : null

  return (
    <html lang="cs" suppressHydrationWarning>
      <head>
        {/* Motiv se nastaví ještě před vykreslením, jinak tmavý režim zabliká bílou. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full antialiased">
        <TooltipProvider delayDuration={300}>
          <AppChrome ucet={ucet}>{children}</AppChrome>
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
