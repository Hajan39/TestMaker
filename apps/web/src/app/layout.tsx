import type { Metadata } from 'next'
import { TooltipProvider } from '@testmaker/ui'
import { MainNav } from '@/components/MainNav'
import './globals.css'

export const metadata: Metadata = {
  title: 'TestMaker – generátor písemek',
  description: 'Z výukových materiálů vytvoří banku otázek a poskládá test do PDF.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body className="min-h-full antialiased">
        <TooltipProvider delayDuration={300}>
          <MainNav>{children}</MainNav>
        </TooltipProvider>
      </body>
    </html>
  )
}
