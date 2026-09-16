import type { Metadata } from 'next'
import { THEME_INIT_SCRIPT, Toaster, TooltipProvider } from '@testmaker/ui'
import { MainNav } from '@/components/MainNav'
import './globals.css'

export const metadata: Metadata = {
  title: 'TestMaker – generátor písemek',
  description: 'Z výukových materiálů vytvoří banku otázek a poskládá test do PDF.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <head>
        {/* Motiv se nastaví ještě před vykreslením, jinak tmavý režim zabliká bílou. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full antialiased">
        <TooltipProvider delayDuration={300}>
          <MainNav>{children}</MainNav>
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
