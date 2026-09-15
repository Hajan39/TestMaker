import type { Metadata } from 'next'
import Link from 'next/link'
import { TooltipProvider } from '@testmaker/ui'
import './globals.css'

export const metadata: Metadata = {
  title: 'TestMaker – generátor písemek',
  description: 'Z výukových materiálů vytvoří banku otázek a poskládá test do PDF.',
}

const NAV = [
  { href: '/', label: 'Přehled' },
  { href: '/import', label: 'Import materiálů' },
  { href: '/questions', label: 'Banka otázek' },
  { href: '/tests', label: 'Testy' },
  { href: '/templates', label: 'Šablony' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body className="min-h-full antialiased">
        <TooltipProvider delayDuration={300}>
          <header className="border-b border-line bg-surface">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/" className="text-base font-semibold text-fg">
                Test<span className="text-brand">Maker</span>
              </Link>
              <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {NAV.slice(1).map((item) => (
                  <Link key={item.href} href={item.href} className="text-fg-soft hover:text-brand">
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  )
}
